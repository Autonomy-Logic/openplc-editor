import type { PLCRemoteDevice } from '@root/middleware/shared/ports/types'
import {
  deviceFieldIssues,
  endpointKey,
  hostOf,
  imageOfFunctionCode,
  isModbusRemoteDevice,
  lineSettingConflicts,
  type MasterIssue,
  type ModbusMasterProfile,
  type ModbusRemoteDevice,
  parseGroupOffset,
  parseIpv4,
  parsePointAddress,
  reconnectConflicts,
  resolveReconnect,
  rs485PinIssues,
  rtuLineOf,
  slaveIdOf,
  tcpPortOf,
  transportIssues,
  transportOf,
} from '@root/middleware/shared/utils/modbus-master-profile'

export interface GenerateModbusMasterHeaderInput {
  /** The project's remote devices; only the Modbus ones are emitted. */
  devices: PLCRemoteDevice[]
  profile: ModbusMasterProfile
  /** The board's UARTs; a bus is emitted only on one of them. */
  board: { serialPorts?: string[]; defaultSerial?: string }
  /** RS-485 enable pin per UART, as the build resolves it; every entry is validated. */
  rs485Pins: Record<string, string>
}

export type GenerateModbusMasterHeaderResult = { ok: true; header: string } | { ok: false; issues: MasterIssue[] }

interface EndpointRow {
  ip: number[]
  port: number
  timeout: number
  reconnect: boolean
  devices: string[]
}

interface BusRow {
  uart: string
  baud: number
  parity: string
  stopBits: number
  dataBits: number
  timeout: number
  pin: string
  devices: string[]
}

interface DeviceRow {
  transport: 'MB_MASTER_TCP' | 'MB_MASTER_RTU'
  link: number
  slaveId: number
  name: string
}

interface GroupRow {
  device: number
  fc: number
  offset: number
  length: number
  cycle: number
  onError: 'MB_ERR_KEEP' | 'MB_ERR_ZERO'
  firstPoint: number
  label: string
}

interface PointRow {
  image: string
  index: number
  bit: number
}

/** Whether a character would end or break a comment line: a C0 or C1 control, or a Unicode line break. */
const isLineBreaking = (char: string): boolean => {
  const code = char.codePointAt(0) ?? 0
  return code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029
}

/** Text safe inside a block comment: no line break, no comment terminator, no control character. */
const cComment = (value: string): string =>
  Array.from(value, (char) => (isLineBreaking(char) ? ' ' : char))
    .join('')
    .replace(/\*\//g, '* /')

/** The issues that refuse the header: the transport, every field, both conflicts and every RS-485 pin. */
function collectIssues(input: GenerateModbusMasterHeaderInput, devices: ModbusRemoteDevice[]): MasterIssue[] {
  const serialPorts = input.board.serialPorts ?? []
  const issues = [
    ...transportIssues(devices, input.profile),
    ...devices.flatMap((device) => deviceFieldIssues(device, serialPorts)),
    ...reconnectConflicts(devices, input.profile),
    ...lineSettingConflicts(devices),
  ]
  for (const [uart, pin] of Object.entries(input.rs485Pins)) {
    const onUart = devices.filter((device) => device.modbusTcpConfig.serialPort === uart).map((device) => device.name)
    issues.push(...rs485PinIssues(uart, pin, onUart))
  }
  return issues.filter((issue) => issue.severity === 'error')
}

/** A number already validated by `deviceFieldIssues`. */
function validated(value: unknown): number {
  if (typeof value !== 'number') throw new Error(`modbus master: unvalidated value ${String(value)}`)
  return value
}

const table = (type: string, name: string, count: string, rows: string[]): string[] =>
  rows.length === 0
    ? []
    : [`static const ${type} ${name}[${count}] = {`, rows.map((row) => `    ${row}`).join(',\n'), '};', '']

/**
 * Render `modbus_master_config.h` for the project's Modbus remote devices against the records of
 * `modbus_master_types.h`, or return the issues that refuse it; on an issue no header is produced.
 * Every value is validated first, so the header holds only numbers, enum identifiers, UARTs from the
 * board's list and pins matching the package pattern; names appear only inside comments.
 */
export function generateModbusMasterHeader(input: GenerateModbusMasterHeaderInput): GenerateModbusMasterHeaderResult {
  const devices = input.devices.filter(isModbusRemoteDevice)
  const issues = collectIssues(input, devices)
  if (issues.length > 0) return { ok: false, issues }

  const endpoints = new Map<string, EndpointRow>()
  const buses = new Map<string, BusRow>()
  const deviceRows: DeviceRow[] = []
  const groupRows: GroupRow[] = []
  const pointRows: PointRow[] = []

  for (const device of devices) {
    const config = device.modbusTcpConfig
    const timeout = validated(config.timeout)
    let link: number

    if (transportOf(config) === 'tcp') {
      const key = endpointKey(config, input.profile) ?? ''
      let endpoint = endpoints.get(key)
      if (!endpoint) {
        endpoint = {
          ip: parseIpv4(hostOf(config)) ?? [],
          port: validated(tcpPortOf(config)),
          timeout,
          reconnect: resolveReconnect(config),
          devices: [],
        }
        endpoints.set(key, endpoint)
      }
      endpoint.timeout = Math.min(endpoint.timeout, timeout)
      endpoint.devices.push(device.name)
      link = [...endpoints.keys()].indexOf(key)
    } else {
      const uart = config.serialPort ?? ''
      let bus = buses.get(uart)
      if (!bus) {
        const line = rtuLineOf(config)
        bus = {
          uart,
          baud: validated(line.baudRate),
          parity: `MB_PARITY_${String(line.parity)}`,
          stopBits: validated(line.stopBits),
          dataBits: validated(line.dataBits),
          timeout,
          pin: Object.prototype.hasOwnProperty.call(input.rs485Pins, uart) ? input.rs485Pins[uart] : 'MB_MASTER_NO_PIN',
          devices: [],
        }
        buses.set(uart, bus)
      }
      bus.timeout = Math.min(bus.timeout, timeout)
      bus.devices.push(device.name)
      link = [...buses.keys()].indexOf(uart)
    }

    const deviceIndex = deviceRows.length
    deviceRows.push({
      transport: transportOf(config) === 'tcp' ? 'MB_MASTER_TCP' : 'MB_MASTER_RTU',
      link,
      slaveId: validated(slaveIdOf(config)),
      name: device.name,
    })

    for (const group of config.ioGroups ?? []) {
      const image = imageOfFunctionCode(group.functionCode)
      if (image === undefined) throw new Error(`modbus master: unvalidated function code ${group.functionCode}`)
      groupRows.push({
        device: deviceIndex,
        fc: Number.parseInt(group.functionCode, 10),
        offset: parseGroupOffset(group.offset) ?? 0,
        length: group.length,
        cycle: group.cycleTime,
        onError: group.errorHandling === 'set-to-zero' ? 'MB_ERR_ZERO' : 'MB_ERR_KEEP',
        firstPoint: pointRows.length,
        label: `${device.name} / ${group.name}`,
      })
      for (const point of group.ioPoints ?? []) {
        const address = parsePointAddress(point.iecLocation, image)
        if (address === null) throw new Error(`modbus master: unvalidated point address ${point.iecLocation}`)
        pointRows.push({ image: `MB_IMG_${address.image}`, index: address.index, bit: address.bit })
      }
    }
  }

  const endpointList = [...endpoints.values()]
  const busList = [...buses.values()]

  const lines: string[] = [
    '// modbus_master_config.h — auto-generated, do not edit by hand.',
    '//',
    "// Written by generate-modbus-master-header.ts from the project's Modbus",
    '// remote devices. Record types: modbus_master_types.h.',
    '',
    '#ifndef MODBUS_MASTER_CONFIG_H',
    '#define MODBUS_MASTER_CONFIG_H',
    '',
    '#include "modbus_master_types.h"',
    '',
    '#define MB_MASTER_ENABLED 1',
    `#define MB_MASTER_TCP_ENABLED ${endpointList.length > 0 ? 1 : 0}`,
    `#define MB_MASTER_RTU_ENABLED ${busList.length > 0 ? 1 : 0}`,
    `#define MB_MASTER_ENDPOINT_COUNT ${endpointList.length}`,
    `#define MB_MASTER_BUS_COUNT ${busList.length}`,
    `#define MB_MASTER_DEVICE_COUNT ${deviceRows.length}`,
    `#define MB_MASTER_GROUP_COUNT ${groupRows.length}`,
    `#define MB_MASTER_POINT_COUNT ${pointRows.length}`,
    '',
    ...table(
      'mb_master_endpoint_t',
      'MB_MASTER_ENDPOINTS',
      'MB_MASTER_ENDPOINT_COUNT',
      endpointList.map(
        (row) =>
          `/* ${cComment(row.devices.join(', '))} */ { {${row.ip.join(', ')}}, ${row.port}, ${row.timeout}, ${row.reconnect ? 1 : 0} }`,
      ),
    ),
    ...table(
      'mb_master_bus_t',
      'MB_MASTER_BUSES',
      'MB_MASTER_BUS_COUNT',
      busList.map(
        (row) =>
          `/* ${cComment(row.devices.join(', '))} */ { &${row.uart}, ${row.baud}, ${row.parity}, ${row.stopBits}, ${row.dataBits}, ${row.timeout}, ${row.pin} }`,
      ),
    ),
    ...table(
      'mb_master_device_t',
      'MB_MASTER_DEVICES',
      'MB_MASTER_DEVICE_COUNT',
      deviceRows.map((row) => `/* ${cComment(row.name)} */ { ${row.transport}, ${row.link}, ${row.slaveId} }`),
    ),
    ...table(
      'mb_master_group_t',
      'MB_MASTER_GROUPS',
      'MB_MASTER_GROUP_COUNT',
      groupRows.map(
        (row) =>
          `/* ${cComment(row.label)} */ { ${row.device}, ${row.fc}, ${row.offset}, ${row.length}, ${row.cycle}, ${row.onError}, ${row.firstPoint} }`,
      ),
    ),
    ...table(
      'mb_master_point_t',
      'MB_MASTER_POINTS',
      'MB_MASTER_POINT_COUNT',
      pointRows.map((row) => `{ ${row.image}, ${row.index}, ${row.bit} }`),
    ),
    '#endif // MODBUS_MASTER_CONFIG_H',
  ]

  return { ok: true, header: `${lines.join('\n')}\n` }
}
