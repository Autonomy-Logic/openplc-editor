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
  modbus_rtu?: {
    enabled?: boolean
    rtu_interface?: string
    rtu_baud_rate?: string
    rtu_slave_id?: number
    enable_rs485_en_pin?: boolean
    rtu_rs485_en_pin?: string
  }
  modbus_tcp?: {
    enabled?: boolean
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
  rtu_interface: 'Serial',
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
export function generateModbusDefines(state: VppModbusScreenState): string {
  const rtu = state.modbus_rtu ?? {}
  const tcp = state.modbus_tcp ?? {}
  const rtuOn = rtu.enabled === true
  const tcpOn = tcp.enabled === true

  if (!rtuOn && !tcpOn) return ''

  const lines: string[] = []
  lines.push('//Comms Configuration')

  if (rtuOn) {
    const iface = rtu.rtu_interface ?? RTU_DEFAULTS.rtu_interface
    const baud = rtu.rtu_baud_rate ?? RTU_DEFAULTS.rtu_baud_rate
    const slave = typeof rtu.rtu_slave_id === 'number' ? rtu.rtu_slave_id : RTU_DEFAULTS.rtu_slave_id
    lines.push(`#define MBSERIAL_IFACE ${iface}`)
    lines.push(`#define MBSERIAL_BAUD ${baud}`)
    lines.push(`#define MBSERIAL_SLAVE ${slave}`)
    if (rtu.enable_rs485_en_pin === true && rtu.rtu_rs485_en_pin) {
      lines.push(`#define MBSERIAL_TXPIN ${rtu.rtu_rs485_en_pin}`)
    }
    lines.push('#define MBSERIAL')
  }

  if (tcpOn) {
    // MBTCP_MAC / MBTCP_IP / MBTCP_DNS / MBTCP_GATEWAY / MBTCP_SUBNET
    // are referenced unconditionally inside the `#ifdef MBTCP` block in
    // `resources/sources/Baremetal/Baremetal.ino` (it builds five byte
    // arrays and uses `sizeof(arr) < 4` as a compile-time DHCP-vs-static
    // selector that cascades through to `mbconfig_ethernet_iface(mac,
    // …, NULL, NULL, …)`). Missing a single macro fails compilation; an
    // unset macro is signalled by emitting a single-byte `0` so the
    // array has `sizeof == 1`, the `< 4` check fires, and the runtime
    // falls back to the DHCP/NULL path. Wi-Fi mode ignores these args
    // inside `mbconfig_ethernet_iface` (see `ModbusSlave.cpp:199-225`),
    // so the placeholder values are harmless there too.
    const macLiteral = tcp.tcp_mac_address ? formatMacForDefine(tcp.tcp_mac_address) : '0'
    lines.push(`#define MBTCP_MAC ${macLiteral}`)

    const dhcpOn = tcp.enable_dhcp === true
    const ipLiteral = !dhcpOn && tcp.ip_address ? formatIpForDefine(tcp.ip_address) : '0'
    const dnsLiteral = !dhcpOn && tcp.dns ? formatIpForDefine(tcp.dns) : '0'
    const gatewayLiteral = !dhcpOn && tcp.gateway ? formatIpForDefine(tcp.gateway) : '0'
    const subnetLiteral = !dhcpOn && tcp.subnet ? formatIpForDefine(tcp.subnet) : '0'
    lines.push(`#define MBTCP_IP ${ipLiteral}`)
    lines.push(`#define MBTCP_DNS ${dnsLiteral}`)
    lines.push(`#define MBTCP_GATEWAY ${gatewayLiteral}`)
    lines.push(`#define MBTCP_SUBNET ${subnetLiteral}`)

    const iface = tcp.tcp_interface ?? TCP_DEFAULTS.tcp_interface
    if (iface === 'Wi-Fi') {
      if (tcp.tcp_wifi_ssid) lines.push(`#define MBTCP_SSID "${tcp.tcp_wifi_ssid}"`)
      if (tcp.tcp_wifi_password) lines.push(`#define MBTCP_PWD "${tcp.tcp_wifi_password}"`)
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
