/**
 * Emit the `//Comms Configuration` block in `defines.h` from a board's
 * persisted VPP Modbus screen state.
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
  /** Phase 2 Serial section — always-on serial baud (debugger + RTU on the
   *  default port). */
  serial?: {
    baud_rate?: string
  }
  /** Phase 2 Network section — Ethernet/Wi-Fi config lifted out of modbus_tcp. */
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
  modbus_rtu?: {
    enabled?: boolean
    /** Phase 2: chosen serial port. Legacy projects use `rtu_interface`. */
    serial_port?: string
    rtu_interface?: string
    /** Phase 2: baud for RTU on a secondary port. On the default port the
     *  Serial section's baud is used. Legacy projects use `rtu_baud_rate`. */
    baud_rate?: string
    rtu_baud_rate?: string
    rtu_slave_id?: number
    enable_rs485_en_pin?: boolean
    rtu_rs485_en_pin?: string
  }
  modbus_tcp?: {
    enabled?: boolean
    unit_id?: number
    // Legacy network fields (pre-Phase-2 projects still on the old screen).
    // Read as a fallback when the `network` section is absent.
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

/** Baud the always-on debugger falls back to when nothing else says otherwise. */
export const DEFAULT_DEBUG_BAUD = '115200'

/**
 * Baud rate the DEFAULT serial port comes up at — the one the always-on debugger
 * answers on, and therefore the one the editor must dial to reach it.
 *
 * The two sides derive this independently (the firmware from here, the editor
 * from the board's `debug` spec), so they have to agree or the port opens and
 * decodes nothing. What the editor dials is
 * `screens.modbus_rtu.rtu_baud_rate` — ALWAYS, whether or not the RTU is
 * enabled, because a spec's `params` are read independently of its
 * `enabledWhen`. This function mirrors that:
 *
 *  1. A `serial` section, when a package declares one — it exists precisely to
 *     configure this port, and a package that has it also points its debug spec
 *     at it.
 *  2. Otherwise the RTU's baud, which for a package published today is the only
 *     serial speed the project states at all. This holds even when the RTU is
 *     DISABLED: the rate is then unused by Modbus, but the editor still dials it,
 *     so the firmware had better listen there.
 *  3. `115200` only when the RTU is enabled on a SECOND UART — the one case where
 *     that rate genuinely belongs to a different port and the debugger keeps the
 *     default one to itself. Nothing states that port's speed, so this is a
 *     guess, and it is exactly the case the connect flow's baud sweep exists for.
 */
export function resolveDebugBaud(state: VppModbusScreenState, defaultSerial: string = 'Serial'): string {
  const declared = state.serial?.baud_rate
  if (declared) return declared

  const rtu = state.modbus_rtu
  if (!rtu) return DEFAULT_DEBUG_BAUD

  // An enabled RTU on its own UART takes its baud with it; the debugger is then
  // on a port whose speed the project never mentions.
  if (rtu.enabled === true) {
    const iface = rtu.serial_port ?? rtu.rtu_interface ?? defaultSerial
    if (iface !== defaultSerial) return DEFAULT_DEBUG_BAUD
  }

  return rtu.baud_rate ?? rtu.rtu_baud_rate ?? DEFAULT_DEBUG_BAUD
}

/** Slave id the always-on debugger frames on when the project states none. */
export const DEFAULT_DEBUG_SLAVE = 1

/**
 * Modbus slave id the always-on debugger answers on — and therefore the id the
 * editor must address to reach it.
 *
 * The same two-sided agreement `resolveDebugBaud` describes, and the same failure
 * when it breaks: `handle_serial_port` drops any frame whose first byte is not
 * this id, and that check is the ONLY validation applied to debug function codes
 * (CRC is skipped on them). A mismatch is therefore total silence on a healthy
 * board — reported as "No Firmware Detected".
 *
 * What the editor addresses is `screens.modbus_rtu.rtu_slave_id`, ALWAYS: a
 * spec's `params` are read independently of its `enabledWhen`, so an RTU screen
 * left at slave id 7 with the RTU toggle OFF still sends id 7 down the cable.
 * So this returns that id unconditionally — including when the RTU runs on a
 * SECOND UART, where it is not a conflict but the same number on two distinct
 * ports.
 *
 * Deliberately NOT the `resolveDebugBaud` shape of "guess 115200 for a secondary
 * port": a wrong baud is recoverable, because Connect sweeps the plausible rates.
 * There is no sweep for slave ids, so this has to match exactly rather than
 * approximately.
 */
export function resolveDebugSlave(state: VppModbusScreenState): number {
  const slave = state.modbus_rtu?.rtu_slave_id
  return typeof slave === 'number' ? slave : DEFAULT_DEBUG_SLAVE
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
export function generateModbusDefines(state: VppModbusScreenState, defaultSerial: string = 'Serial'): string {
  const rtu = state.modbus_rtu ?? {}
  const tcp = state.modbus_tcp ?? {}
  const net = state.network ?? {}
  const rtuOn = rtu.enabled === true
  const tcpOn = tcp.enabled === true

  if (!rtuOn && !tcpOn) return ''

  const lines: string[] = []
  lines.push('//Comms Configuration')

  if (rtuOn) {
    // Phase 2: RTU picks a serial port (`serial_port`); legacy projects carry
    // `rtu_interface`. On the default port the RTU shares the always-on Serial
    // baud; on a secondary port it uses its own (`baud_rate`), with the legacy
    // `rtu_baud_rate` as a fallback for pre-migration projects.
    const iface = rtu.serial_port ?? rtu.rtu_interface ?? defaultSerial
    const onDefaultPort = iface === defaultSerial
    const baud = onDefaultPort
      ? (state.serial?.baud_rate ?? rtu.rtu_baud_rate ?? RTU_DEFAULTS.rtu_baud_rate)
      : (rtu.baud_rate ?? rtu.rtu_baud_rate ?? RTU_DEFAULTS.rtu_baud_rate)
    const slave = typeof rtu.rtu_slave_id === 'number' ? rtu.rtu_slave_id : RTU_DEFAULTS.rtu_slave_id
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
    if (rtu.enable_rs485_en_pin === true && rtu.rtu_rs485_en_pin) {
      lines.push(`#define MBSERIAL_TXPIN ${rtu.rtu_rs485_en_pin}`)
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
    lines.push('#define MBTCP')
  }

  // `MODBUS_ENABLED` gates everything Modbus in ModbusSlave.cpp. Emit
  // once regardless of which transports are active.
  lines.push('#define MODBUS_ENABLED')

  return lines.join('\n') + '\n'
}
