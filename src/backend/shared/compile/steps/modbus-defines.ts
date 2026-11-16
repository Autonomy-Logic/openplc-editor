import {
  LEGACY_RS485_BOARD,
  resolveRs485Pins,
  type Rs485Board,
  rs485PinOf,
} from '../../../../middleware/shared/utils/modbus-master-profile'
import {
  DEFAULT_SERIAL_BAUD,
  isDefaultPort,
  resolveDefaultPortBaud,
  resolveRtuPort,
  resolveServerBaud,
  resolveServerSlaveId,
} from '../../../../middleware/shared/utils/modbus-server-profile'

/**
 * Subset of the persisted screen state this emitter reads. Mirrors the
 * field IDs declared in `screens/modbus.json` — keep in sync if the
 * VPP screen field set evolves.
 */
export interface VppModbusScreenState {
  /** Serial-port section. Owns the physical line the package is responsible
   *  for: the default UART's speed -- the debugger's, and Modbus RTU's when
   *  they share that port -- and the RS-485 driver-enable pin.
   *
   *  Which UART the server answers on, and its speed when it has one to itself,
   *  are the server's and arrive through `ModbusServerCompileConfig`. Nothing
   *  here reads a pre-4.3.0 `modbus_rtu` section: 4.3.0 carries no configuration
   *  forward, and a project from before it creates its server again. */
  serial?: {
    baud_rate?: string
    enable_rs485_en_pin?: boolean
    rs485_en_pin?: string
    /** RS-485 enable pin per UART; once present, the legacy pair above is ignored. */
    rs485_en_pins?: Record<string, string>
  }
  /** Network section — Ethernet/Wi-Fi config lifted out of modbus_tcp by the
   *  screen split. Its `enabled` gates the TCP transport: a project that
   *  declares this section and explicitly turns it off emits no MBTCP. */
  network?: {
    enabled?: boolean
    interface?: 'Ethernet' | 'Wi-Fi'
    mac_address?: string
    wifi_ssid?: string
    wifi_password?: string
    enable_dhcp?: boolean
    ip_address?: string
    gateway?: string
    subnet?: string
    dns?: string
    /** Which SPI Ethernet controller is wired to the board, for the boards that
     *  have no MAC of their own and take a module. "wiznet" is the W5100 /
     *  W5200 / W5500 family, which the Arduino `Ethernet` library tells apart
     *  by itself at begin() -- so this picks the LIBRARY, not the chip.
     *  "enc28j60" is Microchip's, a different part with a different driver
     *  (`EthernetENC`, API-compatible). Absent means wiznet. */
    eth_driver?: 'wiznet' | 'enc28j60'
    /** Chip-select pin for that module. */
    eth_cs_pin?: string | number
  }
}

/** The protocol half, taken from the project's Modbus `PLCServer`. */
export interface ModbusServerCompileConfig {
  enabled?: boolean
  transports?: ('rtu' | 'tcp')[]
  slaveId?: number
  serialPort?: string
  /** Speed of the UART the server answers on. Read only when that UART is not
   *  the default one, whose speed is the editor's line and the package's. */
  baudRate?: number
  port?: number
}

/** Shape of a project server this selector reads. */
interface ModbusServerLike {
  name: string
  protocol: string
  modbusSlaveConfig?: ModbusServerCompileConfig
}

/** The one Modbus server a firmware build can honour, or the conflict to refuse. */
export function selectModbusServer(servers: readonly ModbusServerLike[] | undefined): {
  server?: ModbusServerCompileConfig
  conflict?: string[]
} {
  const serving = (servers ?? []).filter(
    (entry) =>
      entry.protocol === 'modbus-tcp' &&
      entry.modbusSlaveConfig &&
      entry.modbusSlaveConfig.enabled !== false &&
      (entry.modbusSlaveConfig.transports?.length ?? 0) > 0,
  )
  if (serving.length > 1) return { conflict: serving.map((entry) => entry.name) }
  return serving.length === 1 ? { server: serving[0].modbusSlaveConfig } : {}
}

/** Narrow a server's transports to the ones the board can actually carry. */
export function narrowModbusTransports(
  server: ModbusServerCompileConfig | undefined,
  allowed: readonly ('rtu' | 'tcp')[],
  onDropped: (dropped: ('rtu' | 'tcp')[]) => void,
): ModbusServerCompileConfig | undefined {
  if (!server) return undefined
  const requested = server.transports ?? []
  const dropped = requested.filter((transport) => !allowed.includes(transport))
  if (dropped.length === 0) return server
  onDropped(dropped)
  const kept = requested.filter((transport) => allowed.includes(transport))
  return kept.length > 0 ? { ...server, transports: kept } : undefined
}

export { DEFAULT_SERIAL_BAUD, isDefaultPort, resolveDefaultPortBaud, resolveRtuPort, resolveServerSlaveId }

/**
 * Slave id the always-on debugger answers on, and therefore the one the editor
 * dials. A constant, not a setting.
 *
 * The firmware answers it IN ADDITION to whatever the Modbus server is set to,
 * routing by function code (`mb_pdu_is_editor_fc`, `0x41`-`0x4B`), so the two
 * never compete for the same UART and the server's id is the user's to pick on
 * every port. That makes an editor-side id a control that changes nothing:
 * whatever value it held would have to match a firmware the user cannot see, and
 * a mismatch reads as a healthy board that answers nothing. It was briefly a
 * package field (`screens.serial.slave_id`) and is now gone from the packages.
 *
 * A board flashed before this change may still answer on another id. That is
 * Connect's problem, not the emitter's: it tries this id first and the project's
 * legacy one after.
 */
export const DEBUG_SLAVE = 1

/**
 * `aa:bb:cc:dd:ee:ff` → `0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff` so it can
 * land verbatim in `byte mac[] = { MBTCP_MAC };`. Accepts the canonical
 * colon-separated form the screen's `mac-address` field validates; any
 * other shape is treated as already-formatted and returned as-is so the
 * user can supply a pre-formatted literal if they want.
 */
function formatMacForDefine(raw: string): string {
  const colonShape = /^([0-9a-fA-F]{2})(:[0-9a-fA-F]{2}){5}$/
  if (!colonShape.test(raw)) return raw
  return raw
    .split(':')
    .map((b) => `0x${b.toLowerCase()}`)
    .join(', ')
}

/**
 * `192.168.1.100` → `192, 168, 1, 100`. Arduino's `IPAddress` macro
 * expects the byte-list shape inside parentheses. Returns the raw string
 * untouched when it doesn't look like a dotted IPv4 — same defensive
 * stance as `formatMacForDefine`.
 */
function formatIpForDefine(raw: string): string {
  const dottedShape = /^\d{1,3}(\.\d{1,3}){3}$/
  if (!dottedShape.test(raw)) return raw
  return raw.split('.').join(', ')
}

// Defaults mirror the `default` values declared in the canonical VPP Modbus screen
// (`packages/com.openplc.arduino/screens/modbus.json`).

const TCP_DEFAULTS = {
  tcp_interface: 'Ethernet' as const,
}

/** Which carrier to compile when the project never stated one. */
function resolveTcpInterface(stated: string | undefined, declared: string[] | undefined): string {
  if (stated) return stated
  if (declared && declared.length === 1) return declared[0]
  return TCP_DEFAULTS.tcp_interface
}

/** The IANA Modbus port, and what the firmware listened on unconditionally
 *  before the port became the server's to state. */
const BAREMETAL_DEFAULT_TCP_PORT = 502

/** The transports the project's server serves: none when there is no server or it is disabled. */
function servedTransports(server: ModbusServerCompileConfig | undefined): ('rtu' | 'tcp')[] {
  return server && server.enabled !== false ? (server.transports ?? []) : []
}

/**
 * Whether a baremetal build brings the network up (`OPLC_NET_ENABLED`): the Network screen is
 * explicitly on, or the server serves TCP and the screen is not explicitly off.
 */
export function isBuildNetworkEnabled(state: VppModbusScreenState, server?: ModbusServerCompileConfig): boolean {
  const enabled = state.network?.enabled
  return enabled === true || (servedTransports(server).includes('tcp') && enabled !== false)
}

/** UART the project's server answers Modbus RTU on (`MBSERIAL_IFACE`), or `null` when it serves no RTU. */
export function resolveServedRtuUart(
  server: ModbusServerCompileConfig | undefined,
  defaultSerial: string = 'Serial',
): string | null {
  return servedTransports(server).includes('rtu') ? resolveRtuPort(server?.serialPort, defaultSerial) : null
}

/**
 * Build the `//Comms Configuration` block. Returns an empty string when
 * neither RTU nor TCP is enabled so `defines.h` stays clean for boards
 * without Modbus configured.
 *
 * Defaults are applied per-field when the persisted state lacks the
 * value (see the comment on `TCP_DEFAULTS` above for the rationale; the
 * RTU side resolves through `middleware/shared`, which the screen calls
 * too). The `enable_*` gates remain authoritative — defaults only kick
 * in for fields under an active section.
 *
 * The output always ends with a trailing newline so callers can
 * concatenate without adding their own.
 */
export function generateModbusDefines(
  state: VppModbusScreenState,
  defaultSerial: string = 'Serial',
  server?: ModbusServerCompileConfig,
  networkInterfaces?: string[],
  rs485Board: Rs485Board = LEGACY_RS485_BOARD,
): string {
  const net = state.network ?? {}

  const served = servedTransports(server)
  const rtuOn = served.includes('rtu')
  const tcpOn = served.includes('tcp') && net.enabled !== false
  const netOn = net.enabled === true

  if (!rtuOn && !tcpOn && !netOn) return ''

  const lines: string[] = []
  lines.push('//Comms Configuration')

  if (rtuOn) {
    const iface = resolveRtuPort(server?.serialPort, defaultSerial)
    const onDefaultPort = isDefaultPort(iface, defaultSerial)
    const baud = resolveServerBaud({ onDefaultPort, serverBaud: server?.baudRate, state })
    const slave = resolveServerSlaveId(server?.slaveId)
    lines.push(`#define MBSERIAL_IFACE ${iface}`)
    lines.push(`#define MBSERIAL_BAUD ${baud}`)
    lines.push(`#define MBSERIAL_SLAVE ${slave}`)
    if (onDefaultPort) {
      lines.push('#define MBSERIAL_SHARES_DEBUG_SERIAL')
    } else {
      lines.push('#define MBSERIAL_ON_SECONDARY')
    }
    const rs485Pin = rs485PinOf(resolveRs485Pins(state, rs485Board, iface), iface)
    if (rs485Pin !== undefined) {
      lines.push(`#define MBSERIAL_TXPIN ${rs485Pin}`)
    }
    lines.push('#define MBSERIAL')
  }

  if (isBuildNetworkEnabled(state, server)) {
    const mac = net.mac_address
    const ifaceSel = resolveTcpInterface(net.interface, networkInterfaces)
    const dhcpOn = net.enable_dhcp === true
    const ip = net.ip_address
    const dns = net.dns
    const gateway = net.gateway
    const subnet = net.subnet
    const ssid = net.wifi_ssid
    const pwd = net.wifi_password

    lines.push(`#define MBTCP_MAC ${mac ? formatMacForDefine(mac) : '0'}`)
    lines.push(`#define MBTCP_IP ${!dhcpOn && ip ? formatIpForDefine(ip) : '0'}`)
    lines.push(`#define MBTCP_DNS ${!dhcpOn && dns ? formatIpForDefine(dns) : '0'}`)
    lines.push(`#define MBTCP_GATEWAY ${!dhcpOn && gateway ? formatIpForDefine(gateway) : '0'}`)
    lines.push(`#define MBTCP_SUBNET ${!dhcpOn && subnet ? formatIpForDefine(subnet) : '0'}`)

    if (ifaceSel === 'Wi-Fi') {
      if (ssid) lines.push(`#define MBTCP_SSID "${ssid}"`)
      if (pwd) lines.push(`#define MBTCP_PWD "${pwd}"`)
      lines.push('#define MBTCP_WIFI')
    } else {
      lines.push('#define MBTCP_ETHERNET')
      if (net.eth_driver === 'enc28j60') lines.push('#define MBTCP_ETH_ENC28J60')
      const cs = net.eth_cs_pin
      const csNum = typeof cs === 'number' ? cs : cs ? Number(cs) : NaN
      if (Number.isInteger(csNum) && csNum >= 0) lines.push(`#define MBTCP_ETH_CS ${csNum}`)
    }
    lines.push('#define OPLC_NET_ENABLED')
    if (tcpOn) {
      lines.push(`#define MBTCP_PORT ${server?.port ?? BAREMETAL_DEFAULT_TCP_PORT}`)
      lines.push('#define MBTCP')
    }
  }

  if (rtuOn || tcpOn) {
    lines.push('#define MODBUS_ENABLED')
  }

  return lines.join('\n') + '\n'
}
