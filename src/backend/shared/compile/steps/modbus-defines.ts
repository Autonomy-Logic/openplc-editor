/**
 * Emit the `//Comms Configuration` block in `defines.h`.
 *
 * Two sources, split along the ownership boundary: the project's Modbus
 * `PLCServer` says WHAT is served -- the transports, the slave id, the TCP
 * port -- and the board's VPP screens say what it is served OVER: the UART's
 * speed, the RS-485 pin, the network. Protocol is the editor's, the physical
 * layer is the package's, and this function is where the two meet.
 *
 * The screens are declared in `packages/com.openplc.arduino/screens/serial.json`
 * and `network.json` (shared across all Arduino-family VPP packages); their
 * values land in `DeviceConfiguration.vendorScreenData` under the keys `serial`
 * and `network` (one per `section.id` in the screen JSON, resolved by
 * `getSectionPersistenceKey` in `frontend/utils/vpp/persistence-keys.ts`).
 *
 * WHICH transports reach this emitter is narrowed by `narrowModbusTransports`
 * against the board's own carriers before it is called -- serving TCP over a
 * network the board does not have produces firmware that never links.
 *
 * The macros emitted here are the same set the historical
 * `communicationConfiguration` pipeline used (removed in commit
 * c379c7a9c "drop communicationConfiguration from device schema") —
 * `MBSERIAL`, `MBSERIAL_IFACE`, `MBSERIAL_BAUD`, `MBSERIAL_SLAVE`,
 * `MBSERIAL_TXPIN`, `MBTCP`, `MBTCP_ETHERNET`, `MBTCP_WIFI`, `MBTCP_MAC`,
 * `MBTCP_IP`, `MBTCP_DNS`, `MBTCP_GATEWAY`, `MBTCP_SUBNET`, `MBTCP_SSID`,
 * `MBTCP_PWD`, `MODBUS_ENABLED`. The consumer (`resources/sources/
 * Baremetal/ModbusSlave.cpp`) was kept intact and still reads these
 * exact names.
 *
 * Pure function — no I/O, no electron, no store. Caller is responsible
 * for fishing `serial` and `network` out of `vendorScreenData`.
 */

import {
  DEFAULT_SERIAL_BAUD,
  isDefaultPort,
  resolveDefaultPortBaud,
  resolveRs485Pin,
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
   *  here reads a pre-4.4.0 `modbus_rtu` section: 4.4.0 carries no configuration
   *  forward, and a project from before it creates its server again. */
  serial?: {
    baud_rate?: string
    enable_rs485_en_pin?: boolean
    rs485_en_pin?: string
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
  }
}

/**
 * The protocol half, taken from the project's Modbus `PLCServer`.
 *
 * Optional throughout, because a project that has not been opened by an editor
 * new enough to promote its baremetal Modbus to a server still has to compile
 * to the same firmware it compiled to yesterday.
 */
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

/**
 * The one Modbus server a firmware build can honour, or the conflict to refuse.
 *
 * A baremetal firmware serves exactly one slave: `modbus.slaveid` is a single
 * global and `init_mbregs` is called once. The editor still lets a project carry
 * several, on purpose -- a project moves between targets, and a server a Runtime
 * v4 build serves happily should not have to be deleted to build for a
 * microcontroller. So the refusal belongs here, at the point where a single
 * answer is actually required, and it names the servers in conflict rather than
 * saying a number.
 *
 * Nothing serving means no Modbus. There is no fallback to fall back to.
 */
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

/**
 * Narrow a server's transports to the ones the board can actually carry.
 *
 * The project says WHAT is served and the board says what it can be served
 * OVER, and the two have to meet somewhere. They used to meet only on the
 * screen: `resolveModbusServerProfile` decided which transports to offer while
 * this emitter took `server.transports` verbatim. A server seeded with `['tcp']`
 * on a board that ships no Network screen therefore compiled `MBTCP` into a
 * firmware with no network stack, and no `MBSERIAL` either -- a board that
 * answers on nothing, which reads as dead hardware.
 *
 * `dropped` is reported rather than swallowed: the difference between the
 * firmware asked for and the firmware built is exactly the thing a user cannot
 * discover on a microcontroller.
 *
 * Returns the server unchanged when nothing is dropped, so the common path
 * allocates nothing, and `undefined` when nothing survives -- there is no such
 * thing as a server that serves no transport.
 */
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

/**
 * Baud rate the DEFAULT serial port comes up at — the one the always-on debugger
 * answers on, and therefore the one the editor must dial to reach it. It belongs
 * to the package, not to any Modbus server: it is a property of the editor's
 * link, and the debugger answers on it whether or not a server exists.
 *
 * Re-exported rather than defined here because the SCREEN resolves it through
 * the same function. The two sides used to derive it independently, and a screen
 * quietly disagreeing with the firmware is the failure this area keeps
 * producing.
 */
export {
  DEFAULT_SERIAL_BAUD,
  isDefaultPort,
  resolveDefaultPortBaud,
  resolveRs485Pin,
  resolveRtuPort,
  resolveServerSlaveId,
}

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

// Defaults mirror the `default` values declared in the canonical VPP
// Modbus screen (`packages/com.openplc.arduino/screens/modbus.json`).
// They have to live in code rather than be discovered at runtime because
// the form layout (`form-layout.tsx`) only persists fields the user
// touches — toggling "Enable Modbus RTU" alone results in
// `{ enabled: true }` with every other field undefined, but the
// firmware still needs MBSERIAL_IFACE / MBSERIAL_BAUD / MBSERIAL_SLAVE
// to compile (ModbusSlave.cpp uses them as object/literal values).
// Keep these in sync if the screen schema's defaults change.
//
// The RTU slave id is not among them: it is resolved by
// `resolveServerSlaveId`, which the screen calls too.

const TCP_DEFAULTS = {
  tcp_interface: 'Ethernet' as const,
}

/** The IANA Modbus port, and what the firmware listened on unconditionally
 *  before the port became the server's to state. */
const BAREMETAL_DEFAULT_TCP_PORT = 502

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
): string {
  const net = state.network ?? {}

  // The project's server is the only thing that says what is served. No server,
  // no Modbus: 4.4.0 does not read a pre-4.4.0 project's `modbus_rtu` section,
  // so a project from before it has to create its server again.
  const served = server && server.enabled !== false ? (server.transports ?? []) : []
  const rtuOn = served.includes('rtu')
  // Modbus TCP needs a network, and after the screen split the network is a
  // section of its own with its own switch. Serving TCP over a network the
  // project says to leave down produced firmware that compiled MBTCP, called
  // mbconfig_ethernet_iface, and never linked — a healthy board that answers
  // nothing, which reads as broken hardware.
  //
  // Only an EXPLICIT `false` blocks. The form layout persists just the fields
  // the user touched, so a project where someone typed an SSID and never
  // touched the toggle has no `enabled` at all; refusing to build that would
  // trade one silent failure for another. A pre-split project has no `network`
  // section whatsoever and keeps building exactly as it did.
  const tcpOn = served.includes('tcp') && net.enabled !== false

  if (!rtuOn && !tcpOn) return ''

  const lines: string[] = []
  lines.push('//Comms Configuration')

  if (rtuOn) {
    // Which UART is the server's; that UART's speed is the package's. Both the
    // port and the "is it the default one" question come from the shared
    // resolver, because the screen asks the same two and a disagreement puts a
    // read-only baud on screen while the build emits MBSERIAL_ON_SECONDARY.
    const iface = resolveRtuPort(server?.serialPort, defaultSerial)
    const onDefaultPort = isDefaultPort(iface, defaultSerial)
    // The default port's speed is the editor's line and the package's to state;
    // a UART of its own belongs to the server. One UART has one speed, and
    // unlike the slave id no amount of firmware routing changes that.
    const baud = resolveServerBaud({ onDefaultPort, serverBaud: server?.baudRate, state })
    // The server's id, on every port. On the default port the firmware answers
    // DEBUG_SLAVE alongside it for the editor's function codes, so the two share
    // the UART without sharing an address.
    const slave = resolveServerSlaveId(server?.slaveId)
    lines.push(`#define MBSERIAL_IFACE ${iface}`)
    lines.push(`#define MBSERIAL_BAUD ${baud}`)
    lines.push(`#define MBSERIAL_SLAVE ${slave}`)
    // On the default port the RTU IS the debugger's serial → tell the firmware
    // to begin the port once (the always-on debugger already begins it). On a
    // secondary port the RTU runs on a DISTINCT UART while the debugger keeps
    // the default serial, so the firmware services two serial ports.
    if (onDefaultPort) {
      lines.push('#define MBSERIAL_SHARES_DEBUG_SERIAL')
    } else {
      lines.push('#define MBSERIAL_ON_SECONDARY')
    }
    const rs485Pin = resolveRs485Pin(state)
    if (rs485Pin) {
      lines.push(`#define MBSERIAL_TXPIN ${rs485Pin}`)
    }
    lines.push('#define MBSERIAL')
  }

  if (tcpOn) {
    // Network config comes from the `network` section the package ships.
    //
    // MBTCP_MAC / MBTCP_IP / MBTCP_DNS / MBTCP_GATEWAY / MBTCP_SUBNET are
    // referenced unconditionally inside the `#ifdef MBTCP` block in
    // `Baremetal.ino` (five byte arrays, `sizeof(arr) < 4` as a compile-time
    // DHCP-vs-static selector). A missing macro fails compilation; an unset
    // value is signalled by a single-byte `0` so the `< 4` check fires and the
    // runtime falls back to the DHCP/NULL path.
    const mac = net.mac_address
    const ifaceSel = net.interface ?? TCP_DEFAULTS.tcp_interface
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
    }
    lines.push(`#define MBTCP_PORT ${server?.port ?? BAREMETAL_DEFAULT_TCP_PORT}`)
    lines.push('#define MBTCP')
  }

  // `MODBUS_ENABLED` gates everything Modbus in ModbusSlave.cpp. Emit
  // once regardless of which transports are active.
  lines.push('#define MODBUS_ENABLED')

  return lines.join('\n') + '\n'
}
