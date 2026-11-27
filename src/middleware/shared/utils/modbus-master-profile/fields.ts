import type { ModbusIOGroup, ModbusParity, ModbusRemoteTcpConfig, PLCRemoteDevice } from '../../ports/types'
import { DEFAULT_REMOTE_DEVICE_HOST, DEFAULT_REMOTE_DEVICE_PORT } from './default-config'
import type { ModbusMasterTransport } from './profile'
import { isValidRs485Pin } from './rs485-pins'

/** One refusal or warning of the Modbus master checks; `devices` and `item` name what it is about. */
export interface MasterIssue {
  severity: 'error' | 'warning'
  devices: string[]
  item: string
  message: string
}

/** A remote device that carries a Modbus configuration. */
export type ModbusRemoteDevice = PLCRemoteDevice & { modbusTcpConfig: ModbusRemoteTcpConfig }

/** RTU line settings a device gets when none are stored, as the Runtime v4 JSON emits them. */
export const DEFAULT_RTU_LINE = { baudRate: 9600, parity: 'N', stopBits: 1, dataBits: 8 } as const

/** Slave id a device gets when none is stored, as the Runtime v4 JSON emits it. */
export const DEFAULT_SLAVE_ID = 1

const UINT32_MAX = 0xffffffff
const UINT16_MAX = 0xffff
const MODBUS_ADDRESS_SPACE = 0x10000

/** IEC image area of a point, as the firmware's `MB_IMG_*` names it. */
export type MasterImage = 'IX' | 'IW' | 'QX' | 'QW'

/** The image area each function code reads or writes. */
const FC_IMAGE: Record<string, MasterImage> = {
  '1': 'IX',
  '2': 'IX',
  '3': 'IW',
  '4': 'IW',
  '5': 'QX',
  '15': 'QX',
  '6': 'QW',
  '16': 'QW',
}

/** A parsed point address: the image area, the word or byte index and the bit (0 for word areas). */
export interface MasterPointAddress {
  image: MasterImage
  index: number
  bit: number
}

/** The RTU line settings of a device, defaults applied. */
export interface RtuLine {
  baudRate: unknown
  parity: unknown
  stopBits: unknown
  dataBits: unknown
}

/** Whether a remote device carries a Modbus configuration. */
export function isModbusRemoteDevice(device: PLCRemoteDevice): device is ModbusRemoteDevice {
  return device.protocol === 'modbus-tcp' && device.modbusTcpConfig !== undefined && device.modbusTcpConfig !== null
}

/** The device's transport; a device saved before RTU existed is TCP. */
export function transportOf(config: ModbusRemoteTcpConfig): ModbusMasterTransport {
  return config.transport ?? 'tcp'
}

/** The four octets of a dotted IPv4 address, trimmed first, or `null` when the text is not one. */
export function parseIpv4(host: string): number[] | null {
  const parts = host.trim().split('.')
  if (parts.length !== 4) return null
  const octets: number[] = []
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const octet = Number.parseInt(part, 10)
    if (octet > 255) return null
    octets.push(octet)
  }
  return octets
}

/** The host a TCP device connects to, the default host when none is stored. */
export function hostOf(config: ModbusRemoteTcpConfig): string {
  return config.host ?? DEFAULT_REMOTE_DEVICE_HOST
}

/** The port a TCP device connects to, the default port when none is stored. */
export function tcpPortOf(config: ModbusRemoteTcpConfig): unknown {
  return config.port ?? DEFAULT_REMOTE_DEVICE_PORT
}

/** The slave id of a device, the default when none is stored. */
export function slaveIdOf(config: ModbusRemoteTcpConfig): unknown {
  return config.slaveId ?? DEFAULT_SLAVE_ID
}

/** The RTU line settings of a device, each default applied where none is stored. */
export function rtuLineOf(config: ModbusRemoteTcpConfig): RtuLine {
  return {
    baudRate: config.baudRate ?? DEFAULT_RTU_LINE.baudRate,
    parity: config.parity ?? DEFAULT_RTU_LINE.parity,
    stopBits: config.stopBits ?? DEFAULT_RTU_LINE.stopBits,
    dataBits: config.dataBits ?? DEFAULT_RTU_LINE.dataBits,
  }
}

/** Whether `value` is an integer from `min` to `max`. */
export function isIntegerIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

/** A group offset as a number: decimal or `0x` hexadecimal after trim, 0 to 65535; `null` otherwise. */
export function parseGroupOffset(offset: unknown): number | null {
  if (typeof offset !== 'string') return null
  const text = offset.trim()
  let value: number
  if (/^\d+$/.test(text)) value = Number.parseInt(text, 10)
  else if (/^0[xX][0-9a-fA-F]+$/.test(text)) value = Number.parseInt(text.slice(2), 16)
  else return null
  return value <= UINT16_MAX ? value : null
}

/** The image area a function code reads or writes, or `undefined` for a code the master does not run. */
export function imageOfFunctionCode(functionCode: unknown): MasterImage | undefined {
  return typeof functionCode === 'string' && Object.prototype.hasOwnProperty.call(FC_IMAGE, functionCode)
    ? FC_IMAGE[functionCode]
    : undefined
}

/** A point's IEC address when it lies in `image` with an index of at most 65535, otherwise `null`. */
export function parsePointAddress(iecLocation: unknown, image: MasterImage): MasterPointAddress | null {
  if (typeof iecLocation !== 'string') return null
  const isBit = image === 'IX' || image === 'QX'
  const match = isBit
    ? new RegExp(`^%${image}(\\d{1,5})\\.([0-7])$`).exec(iecLocation)
    : new RegExp(`^%${image}(\\d{1,5})$`).exec(iecLocation)
  if (!match) return null
  const index = Number.parseInt(match[1], 10)
  if (index > UINT16_MAX) return null
  return { image, index, bit: isBit ? Number.parseInt(match[2], 10) : 0 }
}

/** The text of a value for a message: strings quoted, everything else as written. */
function shown(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean' || value === undefined || value === null) {
    return String(value)
  }
  return JSON.stringify(value) ?? typeof value
}

/** `"A"`, `"A" and "B"` or `"A", "B" and "C"`. */
export function quotedList(names: string[]): string {
  const quoted = names.map((name) => `"${name}"`)
  if (quoted.length <= 1) return quoted.join('')
  return `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`
}

function fieldError(device: string, item: string, detail: string): MasterIssue {
  return { severity: 'error', devices: [device], item, message: `Remote device "${device}": ${detail}.` }
}

/** The issues of a TCP device's host on a target that takes IPv4 addresses only. */
export function hostIssues(device: ModbusRemoteDevice): MasterIssue[] {
  const host = hostOf(device.modbusTcpConfig)
  if (parseIpv4(host) !== null) return []
  return [
    {
      severity: 'error',
      devices: [device.name],
      item: 'host',
      message: `Remote device "${device.name}" does not support the host "${host}": use an IP address.`,
    },
  ]
}

/** The issue of an RTU device whose serial port is not set or not one of the board's UARTs. */
export function boardSerialPortIssues(device: ModbusRemoteDevice, serialPorts: readonly string[]): MasterIssue[] {
  const port = device.modbusTcpConfig.serialPort
  if (port === undefined || port === '') {
    return [fieldError(device.name, 'serial port', 'serial port is not set')]
  }
  if (serialPorts.includes(port)) return []
  return [
    {
      severity: 'error',
      devices: [device.name],
      item: 'serial port',
      message: `Remote device "${device.name}" does not support ${port}.`,
    },
  ]
}

function groupIssues(device: string, group: ModbusIOGroup): MasterIssue[] {
  const issues: MasterIssue[] = []
  const label = `group ${shown(group.name)}`

  if (!isIntegerIn(group.cycleTime, 1, UINT32_MAX)) {
    issues.push(
      fieldError(
        device,
        'cycle time',
        `${label} cycle time ${shown(group.cycleTime)} is not an integer of at least 1 ms`,
      ),
    )
  }

  const offset = parseGroupOffset(group.offset)
  if (offset === null) {
    issues.push(
      fieldError(
        device,
        'offset',
        `${label} offset ${shown(group.offset)} is not a decimal or 0x hexadecimal number from 0 to 65535`,
      ),
    )
  }

  const points = group.ioPoints ?? []
  if (!isIntegerIn(group.length, 1, MODBUS_ADDRESS_SPACE)) {
    issues.push(fieldError(device, 'length', `${label} length ${shown(group.length)} is not an integer of at least 1`))
  } else {
    if (offset !== null && offset + group.length > MODBUS_ADDRESS_SPACE) {
      issues.push(
        fieldError(device, 'length', `${label} offset ${offset} plus length ${group.length} goes past register 65535`),
      )
    }
    if (group.length !== points.length) {
      issues.push(
        fieldError(device, 'length', `${label} length ${group.length} does not match its ${points.length} point(s)`),
      )
    }
  }

  const image = imageOfFunctionCode(group.functionCode)
  if (image === undefined) {
    issues.push(
      fieldError(
        device,
        'function code',
        `${label} function code ${shown(group.functionCode)} is not 1, 2, 3, 4, 5, 6, 15 or 16`,
      ),
    )
  } else {
    for (const point of points) {
      if (parsePointAddress(point.iecLocation, image) === null) {
        issues.push(
          fieldError(
            device,
            'point address',
            `${label} point address ${shown(point.iecLocation)} is not in the %${image} area of function code ${group.functionCode}`,
          ),
        )
      }
    }
  }

  if (group.errorHandling !== undefined && !['keep-last-value', 'set-to-zero'].includes(group.errorHandling)) {
    issues.push(
      fieldError(
        device,
        'error handling',
        `${label} error handling ${shown(group.errorHandling)} is not keep-last-value or set-to-zero`,
      ),
    )
  }

  return issues
}

/**
 * Field range issues of one device on a baremetal target: host, port, serial port, line settings,
 * slave id, timeout and every group. The transport itself is not checked here.
 */
export function deviceFieldIssues(device: ModbusRemoteDevice, serialPorts: readonly string[]): MasterIssue[] {
  const config = device.modbusTcpConfig
  const issues: MasterIssue[] = []
  const transport = transportOf(config)

  if (transport === 'tcp') {
    issues.push(...hostIssues(device))
    const port = tcpPortOf(config)
    if (!isIntegerIn(port, 1, UINT16_MAX)) {
      issues.push(fieldError(device.name, 'port', `port ${shown(port)} is not an integer from 1 to 65535`))
    }
  } else if (transport === 'rtu') {
    issues.push(...boardSerialPortIssues(device, serialPorts))
    const line = rtuLineOf(config)
    if (!isIntegerIn(line.baudRate, 1, UINT32_MAX)) {
      issues.push(fieldError(device.name, 'baud rate', `baud rate ${shown(line.baudRate)} is not a positive integer`))
    }
    if (!isParity(line.parity)) {
      issues.push(fieldError(device.name, 'parity', `parity ${shown(line.parity)} is not N, E or O`))
    }
    if (line.stopBits !== 1 && line.stopBits !== 2) {
      issues.push(fieldError(device.name, 'stop bits', `stop bits ${shown(line.stopBits)} is not 1 or 2`))
    }
    if (line.dataBits !== 7 && line.dataBits !== 8) {
      issues.push(fieldError(device.name, 'data bits', `data bits ${shown(line.dataBits)} is not 7 or 8`))
    }
  }

  const slaveId = slaveIdOf(config)
  if (!isIntegerIn(slaveId, 0, 255)) {
    issues.push(fieldError(device.name, 'slave id', `slave id ${shown(slaveId)} is not an integer from 0 to 255`))
  }
  if (!isIntegerIn(config.timeout, 1, UINT32_MAX)) {
    issues.push(
      fieldError(device.name, 'timeout', `timeout ${shown(config.timeout)} is not an integer of at least 1 ms`),
    )
  }

  for (const group of config.ioGroups ?? []) {
    issues.push(...groupIssues(device.name, group))
  }
  return issues
}

/** Whether `value` is one of the parities the master runs. */
export function isParity(value: unknown): value is ModbusParity {
  return value === 'N' || value === 'E' || value === 'O'
}

/** The issue of an RS-485 enable pin that does not match the package pin pattern, or none. */
export function rs485PinIssues(uart: string, pin: unknown, devices: string[]): MasterIssue[] {
  if (isValidRs485Pin(pin)) return []
  return [
    {
      severity: 'error',
      devices,
      item: 'RS-485 pin',
      message: `${uart}: RS-485 pin ${shown(pin)} is not a pin name such as 22, A0 or PA14.`,
    },
  ]
}
