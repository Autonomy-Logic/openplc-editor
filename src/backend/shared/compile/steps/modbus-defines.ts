/**
 * Emit the `//Comms Configuration` block in `defines.h`.
 *
 * Two sources, split along the ownership boundary: the project's Modbus
 * `PLCServer` says WHAT is served -- the transports, the slave id, the TCP
 * port -- and the board's VPP screens say what it is served OVER: the UART's
 * speed, the RS-485 pin, the network. Protocol is the editor's, the physical
 * layer is the package's, and this function is where the two meet.
 *
 * The screen is declared in `packages/com.openplc.arduino/screens/modbus.json`
 * (shared across all Arduino-family VPP packages); its values land in
 * `DeviceConfiguration.vendorScreenData` under keys `modbus_rtu` and
 * `modbus_tcp` (one per `section.id` in the screen JSON, resolved by
 * `getSectionPersistenceKey` in `frontend/utils/vpp/persistence-keys.ts`).
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
 * for fishing `modbus_rtu` and `modbus_tcp` out of `vendorScreenData`.
 */

/**
 * Subset of the persisted screen state this emitter reads. Mirrors the
 * field IDs declared in `screens/modbus.json` — keep in sync if the
 * VPP screen field set evolves.
 */
export interface VppModbusScreenState {
  /** Serial-port section. Owns everything about the physical line: the
   *  default port's speed (the debugger's, and Modbus RTU's when they share
   *  it), which UART Modbus RTU answers on, that UART's own speed, and the
   *  RS485 driver-enable pin.
   *
   *  These four moved here from `modbus_rtu` when the unified Modbus server
   *  screen took that section over: the native screen renders `modbus_rtu`
   *  itself, so any field left in it had nowhere to appear. The old spellings
   *  are still read as a fallback -- see the `modbus_rtu` members below. */
  serial?: {
    baud_rate?: string
    /** Slave id the editor's own connection is framed with. The package owns
     *  it because it is a property of that link, not of any Modbus server:
     *  the debugger answers on it whether or not a server exists. */
    slave_id?: number
    modbus_port?: string
    modbus_baud_rate?: string
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
  /** Pre-4.4.0 protocol state, kept only as a fallback for a project whose
   *  baremetal Modbus has not yet been promoted to a `PLCServer` -- one saved
   *  by an older editor and compiled without being opened. The wiring fields
   *  that used to live here are gone: `migrate-modbus-serial-fields` moves
   *  them into `serial`, so reading them would be reading a value the editor
   *  no longer writes. */
  modbus_rtu?: {
    enabled?: boolean
    rtu_slave_id?: number
    baud_rate?: string
    rtu_baud_rate?: string
  }
  modbus_tcp?: {
    enabled?: boolean
    // Legacy network fields, still read: nothing migrates them into `network`,
    // and dropping the fallback would lose a pre-split project's Wi-Fi
    // credentials on upgrade. The protocol fields beside them are gone.
    tcp_interface?: 'Ethernet' | 'Wi-Fi'
    tcp_mac_address?: string
    tcp_wifi_ssid?: string
    tcp_wifi_password?: string
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
 * global and `init_mbregs` is called once. The editor still lets a project
 * carry several, on purpose -- a project moves between targets, and a server
 * that a Runtime v4 build serves happily should not have to be deleted to
 * build for a microcontroller. So the refusal belongs here, at the point where
 * a single answer is actually required, and it names the servers in conflict
 * rather than saying a number.
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
  if (serving.length === 0) return {}
  if (serving.length > 1) return { conflict: serving.map((entry) => entry.name) }
  return { server: serving[0].modbusSlaveConfig }
}

/** Baud the always-on debugger falls back to when nothing else says otherwise. */
export const DEFAULT_DEBUG_BAUD = '115200'

/**
 * Baud rate the DEFAULT serial port comes up at — the one the always-on
 * debugger answers on, and therefore the one the editor must dial to reach it.
 *
 * The two sides derive this independently (the firmware from here, the editor
 * from the board's `debug` spec), so they have to agree or the port opens and
 * decodes nothing.
 *
 * It belongs to the package, not to any Modbus server: it is a property of the
 * editor's link, and the debugger answers on it whether or not a server exists.
 * The RTU's own choice of UART no longer enters into it — when the RTU takes
 * the default port it inherits this speed, and when it takes another one that
 * port's speed is stated separately.
 *
 * The `modbus_rtu` fallbacks are for a project saved before the serial fields
 * moved, where the RTU section was the only place a serial speed was stated at
 * all.
 */
export function resolveDebugBaud(state: VppModbusScreenState): string {
  return state.serial?.baud_rate ?? state.modbus_rtu?.baud_rate ?? state.modbus_rtu?.rtu_baud_rate ?? DEFAULT_DEBUG_BAUD
}

/** Slave id the always-on debugger frames on when the project states none. */
export const DEFAULT_DEBUG_SLAVE = 1

/**
 * Slave id the always-on debugger answers on, and therefore the one the editor
 * dials. The firmware drops every frame whose slave id does not match, and for
 * debug function codes that check is the ONLY validation there is, so the two
 * sides disagreeing means a healthy board that answers nothing.
 *
 * It comes from the package, never from the Modbus server. Welding it to the
 * server's slave id — which is what this used to do — made every change to that
 * field an access event, and made a project with no server unable to debug at
 * all now that a server is something the user creates rather than something
 * every board has.
 *
 * The `modbus_rtu` fallback carries a package published before it declared
 * `serial.slave_id`. The editor's version floor stops an old EDITOR meeting a
 * new package; nothing stops a new editor meeting an old package, which is
 * exactly what this chain is for.
 */
export function resolveDebugSlave(state: VppModbusScreenState): number {
  const declared = state.serial?.slave_id ?? state.modbus_rtu?.rtu_slave_id
  return typeof declared === 'number' ? declared : DEFAULT_DEBUG_SLAVE
}

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
const RTU_DEFAULTS = {
  rtu_baud_rate: '115200',
  rtu_slave_id: 1,
} as const

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
 * value (see comment on `RTU_DEFAULTS` above for the rationale). The
 * `enable_*` gates remain authoritative — defaults only kick in for
 * fields under an active section.
 *
 * The output always ends with a trailing newline so callers can
 * concatenate without adding their own.
 */
export function generateModbusDefines(
  state: VppModbusScreenState,
  defaultSerial: string = 'Serial',
  server?: ModbusServerCompileConfig,
): string {
  const rtu = state.modbus_rtu ?? {}
  const tcp = state.modbus_tcp ?? {}
  const net = state.network ?? {}

  // The project's server is authoritative about what is served. A project that
  // predates it -- never opened by an editor that promotes the screen state --
  // still says so in the screen sections, and must keep compiling to the same
  // firmware it compiled to yesterday.
  // `null` means no server at all -- fall back to the sections. An empty array
  // means a server that exists and serves nothing, which is not the same thing
  // and must not reopen the fallback.
  const served = server ? (server.enabled === false ? [] : (server.transports ?? [])) : null
  const rtuOn = served ? served.includes('rtu') : rtu.enabled === true
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
  const tcpOn = (served ? served.includes('tcp') : tcp.enabled === true) && net.enabled !== false

  if (!rtuOn && !tcpOn) return ''

  const lines: string[] = []
  lines.push('//Comms Configuration')

  if (rtuOn) {
    // Which UART is the server's; that UART's speed is the package's.
    const iface = server?.serialPort || state.serial?.modbus_port || defaultSerial
    const onDefaultPort = iface === defaultSerial
    const baud = onDefaultPort
      ? resolveDebugBaud(state)
      : (state.serial?.modbus_baud_rate ?? RTU_DEFAULTS.rtu_baud_rate)
    // On the default port the RTU and the debugger are one listener, matched by
    // one slave id. Emitting the server's here instead would compile a board
    // that answers the bus on one id and the editor on another, with only one
    // of them able to be right -- so the editor's link wins, which is what the
    // screen shows read-only.
    const slave = onDefaultPort
      ? resolveDebugSlave(state)
      : (server?.slaveId ?? rtu.rtu_slave_id ?? RTU_DEFAULTS.rtu_slave_id)
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
    const rs485On = state.serial?.enable_rs485_en_pin
    const rs485Pin = state.serial?.rs485_en_pin
    if (rs485On === true && rs485Pin) {
      lines.push(`#define MBSERIAL_TXPIN ${rs485Pin}`)
    }
    lines.push('#define MBSERIAL')
  }

  if (tcpOn) {
    // Network config comes from the Phase 2 `network` section, falling back to
    // the legacy `modbus_tcp` fields for pre-migration projects.
    //
    // MBTCP_MAC / MBTCP_IP / MBTCP_DNS / MBTCP_GATEWAY / MBTCP_SUBNET are
    // referenced unconditionally inside the `#ifdef MBTCP` block in
    // `Baremetal.ino` (five byte arrays, `sizeof(arr) < 4` as a compile-time
    // DHCP-vs-static selector). A missing macro fails compilation; an unset
    // value is signalled by a single-byte `0` so the `< 4` check fires and the
    // runtime falls back to the DHCP/NULL path.
    const mac = net.mac_address ?? tcp.tcp_mac_address
    const ifaceSel = net.interface ?? tcp.tcp_interface ?? TCP_DEFAULTS.tcp_interface
    const dhcpOn = (net.enable_dhcp ?? tcp.enable_dhcp) === true
    const ip = net.ip_address ?? tcp.ip_address
    const dns = net.dns ?? tcp.dns
    const gateway = net.gateway ?? tcp.gateway
    const subnet = net.subnet ?? tcp.subnet
    const ssid = net.wifi_ssid ?? tcp.tcp_wifi_ssid
    const pwd = net.wifi_password ?? tcp.tcp_wifi_password

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
