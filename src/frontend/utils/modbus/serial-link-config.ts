/**
 * Defaults, resolution and legacy migration for the two bare-metal blocks of a
 * Modbus server: the serial (RTU) slave and the network link underneath TCP.
 *
 * Until DOPE-442 these lived in each package's `screens/modbus.json` — a screen
 * definition shipped by nine VPP packages, byte-identical in all of them — and
 * their values landed in `DeviceConfiguration.vendorScreenData` keyed by
 * section id (`modbus_rtu`, `modbus_tcp`). The screen moved into the editor's
 * Modbus server editor; this module owns the shape it moved to, and knows how
 * to read a project still carrying the old one.
 *
 * One resolver, deliberately: the screen, the `defines.h` emitter and the
 * debugger's baud lookup all need "what is the effective value of this field",
 * and three hand-copied `??` ladders is how they drift apart.
 *
 * Pure — no I/O, no store, no React.
 */

import type {
  ModbusBaudRate,
  ModbusRtuConfig,
  ModbusSerialPort,
  ModbusTcpLinkConfig,
  ModbusTcpMedium,
} from '../../../middleware/shared/ports/types'

const SERIAL_PORTS: readonly ModbusSerialPort[] = ['Serial', 'Serial1', 'Serial2', 'Serial3']
const BAUD_RATES: readonly ModbusBaudRate[] = ['9600', '14400', '19200', '38400', '57600', '115200']

/**
 * Defaults mirror the retired screen definition field for field, so a project
 * that never opened the screen resolves to what the package would have shown.
 */
const DEFAULT_MODBUS_RTU: ModbusRtuConfig = {
  enabled: false,
  serialPort: 'Serial',
  baudRate: '115200',
  slaveId: 1,
  useRs485EnPin: false,
  rs485EnPin: '',
}

const DEFAULT_MODBUS_TCP_LINK: ModbusTcpLinkConfig = {
  enabled: false,
  medium: 'ethernet',
  macAddress: '',
  wifiSsid: '',
  wifiPassword: '',
  useDhcp: true,
  ipAddress: '',
  gateway: '',
  subnet: '',
  dns: '',
}

/** Modbus RTU reserves 0 for broadcast and 248-255; 1-247 addresses a slave. */
const MIN_SLAVE_ID = 1
const MAX_SLAVE_ID = 247

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key]
  return typeof value === 'string' ? value : undefined
}

function readBoolean(source: Record<string, unknown>, key: string): boolean | undefined {
  const value = source[key]
  return typeof value === 'boolean' ? value : undefined
}

/**
 * The screen's `number` field persisted whatever the input produced, so a
 * project can carry `"12"` where a number belongs. Numeric strings are read;
 * anything that isn't a finite number is left to the default.
 */
function readNumber(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

/** Narrow to a member of `allowed`, or `undefined` — never a silent cast. */
function readOneOf<T extends string>(
  source: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const value = source[key]
  return allowed.find((candidate): candidate is T => candidate === value)
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? { ...value } : {}
}

/**
 * Field by field rather than a spread: `{ ...defaults, ...partial }` copies a
 * key that is explicitly `undefined` straight over the default, and every
 * caller here builds its partial from lookups that return `undefined` when
 * they find nothing.
 */
function resolveModbusRtu(partial?: Partial<ModbusRtuConfig>): ModbusRtuConfig {
  return {
    enabled: partial?.enabled ?? DEFAULT_MODBUS_RTU.enabled,
    serialPort: partial?.serialPort ?? DEFAULT_MODBUS_RTU.serialPort,
    baudRate: partial?.baudRate ?? DEFAULT_MODBUS_RTU.baudRate,
    slaveId: partial?.slaveId ?? DEFAULT_MODBUS_RTU.slaveId,
    useRs485EnPin: partial?.useRs485EnPin ?? DEFAULT_MODBUS_RTU.useRs485EnPin,
    rs485EnPin: partial?.rs485EnPin ?? DEFAULT_MODBUS_RTU.rs485EnPin,
  }
}

function resolveModbusTcpLink(partial?: Partial<ModbusTcpLinkConfig>): ModbusTcpLinkConfig {
  return {
    enabled: partial?.enabled ?? DEFAULT_MODBUS_TCP_LINK.enabled,
    medium: partial?.medium ?? DEFAULT_MODBUS_TCP_LINK.medium,
    macAddress: partial?.macAddress ?? DEFAULT_MODBUS_TCP_LINK.macAddress,
    wifiSsid: partial?.wifiSsid ?? DEFAULT_MODBUS_TCP_LINK.wifiSsid,
    wifiPassword: partial?.wifiPassword ?? DEFAULT_MODBUS_TCP_LINK.wifiPassword,
    useDhcp: partial?.useDhcp ?? DEFAULT_MODBUS_TCP_LINK.useDhcp,
    ipAddress: partial?.ipAddress ?? DEFAULT_MODBUS_TCP_LINK.ipAddress,
    gateway: partial?.gateway ?? DEFAULT_MODBUS_TCP_LINK.gateway,
    subnet: partial?.subnet ?? DEFAULT_MODBUS_TCP_LINK.subnet,
    dns: partial?.dns ?? DEFAULT_MODBUS_TCP_LINK.dns,
  }
}

/** Clamp a typed slave id into the range the protocol allows. */
function clampSlaveId(slaveId: number): number {
  return Math.min(MAX_SLAVE_ID, Math.max(MIN_SLAVE_ID, Math.trunc(slaveId)))
}

/**
 * Read the retired VPP screen state into the model that replaced it.
 *
 * Both field spellings are accepted. The packages shipped today write
 * `rtu_interface` / `rtu_baud_rate`; the emitter also tolerated a later
 * `serial_port` / `baud_rate` pair, and a project may carry either.
 *
 * Returns `null` when the state holds neither section, so a caller can tell
 * "nothing to migrate" from "migrated to the defaults".
 */
function migrateVendorScreenModbus(
  vendorScreenData: Record<string, unknown> | undefined,
): { rtu: ModbusRtuConfig; tcpLink: ModbusTcpLinkConfig } | null {
  if (!vendorScreenData) return null
  const hasRtu = Object.prototype.hasOwnProperty.call(vendorScreenData, 'modbus_rtu')
  const hasTcp = Object.prototype.hasOwnProperty.call(vendorScreenData, 'modbus_tcp')
  if (!hasRtu && !hasTcp) return null

  const rtuState = asRecord(vendorScreenData['modbus_rtu'])
  const tcpState = asRecord(vendorScreenData['modbus_tcp'])
  const slaveId = readNumber(rtuState, 'rtu_slave_id')

  return {
    rtu: resolveModbusRtu({
      enabled: readBoolean(rtuState, 'enabled'),
      serialPort:
        readOneOf(rtuState, 'serial_port', SERIAL_PORTS) ?? readOneOf(rtuState, 'rtu_interface', SERIAL_PORTS),
      baudRate: readOneOf(rtuState, 'baud_rate', BAUD_RATES) ?? readOneOf(rtuState, 'rtu_baud_rate', BAUD_RATES),
      slaveId: slaveId === undefined ? undefined : clampSlaveId(slaveId),
      useRs485EnPin: readBoolean(rtuState, 'enable_rs485_en_pin'),
      rs485EnPin: readString(rtuState, 'rtu_rs485_en_pin'),
    }),
    tcpLink: resolveModbusTcpLink({
      enabled: readBoolean(tcpState, 'enabled'),
      medium: readMedium(tcpState),
      macAddress: readString(tcpState, 'tcp_mac_address'),
      wifiSsid: readString(tcpState, 'tcp_wifi_ssid'),
      wifiPassword: readString(tcpState, 'tcp_wifi_password'),
      useDhcp: readBoolean(tcpState, 'enable_dhcp'),
      ipAddress: readString(tcpState, 'ip_address'),
      gateway: readString(tcpState, 'gateway'),
      subnet: readString(tcpState, 'subnet'),
      dns: readString(tcpState, 'dns'),
    }),
  }
}

/** The screen persisted the medium as its own label (`Ethernet` / `Wi-Fi`). */
function readMedium(tcpState: Record<string, unknown>): ModbusTcpMedium | undefined {
  const label = readString(tcpState, 'tcp_interface')
  if (label === 'Ethernet') return 'ethernet'
  if (label === 'Wi-Fi') return 'wifi'
  return undefined
}

export {
  BAUD_RATES,
  clampSlaveId,
  DEFAULT_MODBUS_RTU,
  DEFAULT_MODBUS_TCP_LINK,
  MAX_SLAVE_ID,
  migrateVendorScreenModbus,
  MIN_SLAVE_ID,
  resolveModbusRtu,
  resolveModbusTcpLink,
  SERIAL_PORTS,
}
