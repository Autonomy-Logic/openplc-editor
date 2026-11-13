import type { PLCRemoteDevice } from '../../ports/types'
import { endpointKey } from './endpoint'
import {
  boardSerialPortIssues,
  deviceFieldIssues,
  hostIssues,
  isModbusRemoteDevice,
  type MasterIssue,
  type ModbusRemoteDevice,
  quotedList,
  rs485PinIssues,
  rtuLineOf,
  transportOf,
} from './fields'
import type { ModbusMasterProfile } from './profile'
import { resolveReconnect } from './reconnect'

/** The build targets the master checks tell apart. */
export type MasterTarget = 'baremetal' | 'runtime-v4' | 'runtime-v3' | 'simulator'

/** Board facts the master checks read. */
export interface MasterBoard {
  serialPorts?: string[]
  defaultSerial?: string
  /** RS-485 enable pin per UART, as the build resolves it. */
  rs485Pins: Record<string, string>
}

export interface CheckModbusMasterInput {
  /** The project's remote devices; only the Modbus ones are checked. */
  devices: PLCRemoteDevice[]
  profile: ModbusMasterProfile
  board: MasterBoard
  /** UART of the enabled Modbus RTU server, or `null` when the build serves no RTU. */
  rtuServerUart: string | null
  /** Whether the build brings the network up (`OPLC_NET_ENABLED`). */
  networkEnabled: boolean
  target: MasterTarget
  /** Whether the project has any remote device, EtherCAT included. */
  hasRemoteDevices: boolean
  /** The selected target's name, quoted in the Remote IO warning. */
  boardTarget?: string
}

/** UART the debugger sits on when a package declares no `defaultSerial`. */
const FALLBACK_DEFAULT_SERIAL = 'Serial'

/** The warning a target that ignores remote devices gives for a project that has some. */
export function remoteIoWarning(boardTarget: string | undefined): string {
  const target = boardTarget === undefined ? 'the selected target' : `the selected target (${boardTarget})`
  return `Warning: Your project contains Remote IO configurations, but ${target} does not support this feature. The remote device configurations will be ignored during compilation.`
}

/** Groups items by a key, keeping first-seen order; items whose key is `null` are left out. */
function groupBy<T>(items: readonly T[], keyOf: (item: T) => string | null): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const key = keyOf(item)
    if (key === null) continue
    const group = groups.get(key)
    if (group) group.push(item)
    else groups.set(key, [item])
  }
  return groups
}

const names = (devices: readonly ModbusRemoteDevice[]): string[] => devices.map((device) => device.name)

/** TCP devices on one endpoint (`endpointKey`) that disagree on Reconnect. */
export function reconnectConflicts(
  devices: readonly ModbusRemoteDevice[],
  profile: ModbusMasterProfile,
): MasterIssue[] {
  const issues: MasterIssue[] = []
  for (const [key, shared] of groupBy(devices, (device) => endpointKey(device.modbusTcpConfig, profile))) {
    const values = new Set(shared.map((device) => resolveReconnect(device.modbusTcpConfig)))
    if (values.size > 1) {
      issues.push({
        severity: 'error',
        devices: names(shared),
        item: 'Reconnect',
        message: `Remote devices ${quotedList(names(shared))} on ${key} disagree on Reconnect.`,
      })
    }
  }
  return issues
}

const LINE_SETTINGS = [
  { key: 'baudRate', item: 'baud rate' },
  { key: 'parity', item: 'parity' },
  { key: 'stopBits', item: 'stop bits' },
  { key: 'dataBits', item: 'data bits' },
] as const

/** RTU devices on one serial port that disagree on a line setting, one issue per setting. */
export function lineSettingConflicts(devices: readonly ModbusRemoteDevice[]): MasterIssue[] {
  const rtuDevices = devices.filter((device) => transportOf(device.modbusTcpConfig) === 'rtu')
  const issues: MasterIssue[] = []
  for (const [port, shared] of groupBy(rtuDevices, (device) => device.modbusTcpConfig.serialPort || null)) {
    for (const setting of LINE_SETTINGS) {
      const values = new Set(shared.map((device) => rtuLineOf(device.modbusTcpConfig)[setting.key]))
      if (values.size > 1) {
        issues.push({
          severity: 'error',
          devices: names(shared),
          item: setting.item,
          message: `Remote devices ${quotedList(names(shared))} on ${port} disagree on the ${setting.item}.`,
        })
      }
    }
  }
  return issues
}

/** Devices whose transport the target does not offer. */
export function transportIssues(devices: readonly ModbusRemoteDevice[], profile: ModbusMasterProfile): MasterIssue[] {
  return devices
    .filter((device) => !profile.transports.includes(transportOf(device.modbusTcpConfig)))
    .map((device) => ({
      severity: 'error' as const,
      devices: [device.name],
      item: 'transport',
      message: `Remote device "${device.name}" does not support ${transportOf(device.modbusTcpConfig).toUpperCase()}.`,
    }))
}

/**
 * Devices a baremetal target cannot run whatever the project's settings: a transport the board does not
 * offer, a host that is not an IPv4 address, a serial port the board does not have.
 */
export function unrunnableDeviceIssues(
  devices: readonly PLCRemoteDevice[],
  profile: ModbusMasterProfile,
  board: Pick<MasterBoard, 'serialPorts'>,
): MasterIssue[] {
  const modbus = devices.filter(isModbusRemoteDevice)
  const issues = transportIssues(modbus, profile)
  for (const device of modbus) {
    const transport = transportOf(device.modbusTcpConfig)
    if (transport === 'tcp') issues.push(...hostIssues(device))
    if (transport === 'rtu') issues.push(...boardSerialPortIssues(device, board.serialPorts ?? []))
  }
  return issues
}

/** Names of the Modbus remote devices a baremetal target cannot run (`unrunnableDeviceIssues`); empty elsewhere. */
export function devicesBaremetalCannotRun(
  devices: readonly PLCRemoteDevice[],
  profile: ModbusMasterProfile,
  board: Pick<MasterBoard, 'serialPorts'>,
): string[] {
  if (profile.rtuPorts.source !== 'board') return []
  return [...new Set(unrunnableDeviceIssues(devices, profile, board).flatMap((issue) => issue.devices))]
}

function networkIssues(devices: readonly ModbusRemoteDevice[], profile: ModbusMasterProfile): MasterIssue[] {
  return devices
    .filter((device) => transportOf(device.modbusTcpConfig) === 'tcp' && profile.transports.includes('tcp'))
    .map((device) => ({
      severity: 'error' as const,
      devices: [device.name],
      item: 'network',
      message: `Remote device "${device.name}" does not support TCP without the network enabled.`,
    }))
}

function reservedUartIssues(
  devices: readonly ModbusRemoteDevice[],
  debuggerUart: string,
  rtuServerUart: string | null,
): MasterIssue[] {
  const issues: MasterIssue[] = []
  for (const device of devices) {
    const port = device.modbusTcpConfig.serialPort
    if (transportOf(device.modbusTcpConfig) !== 'rtu' || port === undefined) continue
    if (port === debuggerUart) {
      issues.push({
        severity: 'error',
        devices: [device.name],
        item: 'serial port',
        message: `Remote device "${device.name}" uses ${port}, the debugger's UART.`,
      })
    } else if (rtuServerUart !== null && port === rtuServerUart) {
      issues.push({
        severity: 'error',
        devices: [device.name],
        item: 'serial port',
        message: `Remote device "${device.name}" uses ${port}, the Modbus RTU server's UART.`,
      })
    }
  }
  return issues
}

function masterUartPinIssues(devices: readonly ModbusRemoteDevice[], rs485Pins: Record<string, string>): MasterIssue[] {
  const rtuDevices = devices.filter((device) => transportOf(device.modbusTcpConfig) === 'rtu')
  const issues: MasterIssue[] = []
  for (const [uart, shared] of groupBy(rtuDevices, (device) => device.modbusTcpConfig.serialPort || null)) {
    if (Object.prototype.hasOwnProperty.call(rs485Pins, uart)) {
      issues.push(...rs485PinIssues(uart, rs485Pins[uart], names(shared)))
    }
  }
  return issues
}

function socketBudgetIssues(devices: readonly ModbusRemoteDevice[], profile: ModbusMasterProfile): MasterIssue[] {
  if (profile.socketBudget === null) return []
  const tcpDevices = devices.filter((device) => transportOf(device.modbusTcpConfig) === 'tcp')
  const endpoints = groupBy(tcpDevices, (device) => endpointKey(device.modbusTcpConfig, profile))
  if (endpoints.size <= profile.socketBudget) return []
  return [
    {
      severity: 'warning',
      devices: names(tcpDevices),
      item: 'network sockets',
      message: `${endpoints.size} TCP endpoints exceed the ${profile.socketBudget} network sockets this board declares.`,
    },
  ]
}

/**
 * The pre-build checks of the project's Modbus remote devices for one target.
 *
 * Runtime v3 only warns that remote devices are ignored. The Simulator refuses mismatched Reconnect or
 * line settings and warns that it ignores the devices. Runtime v4 also refuses a transport it does not
 * offer. Baremetal also refuses reserved UARTs, hosts that are not IPv4, ports the board lacks, values out
 * of range and bad RS-485 pins, and warns when the TCP endpoints exceed the declared sockets.
 */
export function checkModbusMaster(input: CheckModbusMasterInput): MasterIssue[] {
  const { profile, board, target } = input

  if (target === 'runtime-v3') {
    return input.hasRemoteDevices ? [remoteIoIssue(input)] : []
  }

  const devices = input.devices.filter(isModbusRemoteDevice)
  const issues = [...reconnectConflicts(devices, profile), ...lineSettingConflicts(devices)]

  if (target === 'simulator') {
    if (input.hasRemoteDevices) issues.push(remoteIoIssue(input))
    return issues
  }

  issues.push(...transportIssues(devices, profile))
  if (!input.networkEnabled) issues.push(...networkIssues(devices, profile))

  if (target === 'baremetal') {
    const offered = devices.filter((device) => profile.transports.includes(transportOf(device.modbusTcpConfig)))
    issues.push(
      ...reservedUartIssues(offered, board.defaultSerial ?? FALLBACK_DEFAULT_SERIAL, input.rtuServerUart),
      ...devices.flatMap((device) => deviceFieldIssues(device, board.serialPorts ?? [])),
      ...masterUartPinIssues(devices, board.rs485Pins),
      ...socketBudgetIssues(devices, profile),
    )
  }

  return issues
}

function remoteIoIssue(input: CheckModbusMasterInput): MasterIssue {
  return {
    severity: 'warning',
    devices: input.devices.map((device) => device.name),
    item: 'Remote IO',
    message: remoteIoWarning(input.boardTarget),
  }
}
