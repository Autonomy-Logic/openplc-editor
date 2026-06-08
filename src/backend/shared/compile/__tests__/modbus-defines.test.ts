import { generateModbusDefines } from '../steps/modbus-defines'

describe('generateModbusDefines', () => {
  it('returns an empty string when neither RTU nor TCP is enabled', () => {
    expect(generateModbusDefines({})).toBe('')
    expect(generateModbusDefines({ modbus_rtu: {}, modbus_tcp: {} })).toBe('')
    expect(generateModbusDefines({ modbus_rtu: { enabled: false }, modbus_tcp: { enabled: false } })).toBe('')
  })

  it('emits the canonical RTU block with screen defaults explicitly provided', () => {
    const out = generateModbusDefines({
      modbus_rtu: {
        enabled: true,
        rtu_interface: 'Serial',
        rtu_baud_rate: '115200',
        rtu_slave_id: 1,
      },
    })
    expect(out).toBe(
      [
        '//Comms Configuration',
        '#define MBSERIAL_IFACE Serial',
        '#define MBSERIAL_BAUD 115200',
        '#define MBSERIAL_SLAVE 1',
        '#define MBSERIAL',
        '#define MODBUS_ENABLED',
        '',
      ].join('\n'),
    )
  })

  it('applies RTU schema defaults when only `enabled: true` is persisted (form-layout writes only touched fields)', () => {
    // Real-world scenario: user toggles "Enable Modbus RTU" without
    // editing baud/interface/slave — form-layout writes only the field
    // that changed. ModbusSlave.cpp still expects MBSERIAL_IFACE,
    // MBSERIAL_BAUD, MBSERIAL_SLAVE to compile (object reference +
    // numeric literals), so the helper must fill them from screen
    // defaults rather than leaving them undefined.
    const out = generateModbusDefines({ modbus_rtu: { enabled: true } })
    expect(out).toContain('#define MBSERIAL_IFACE Serial')
    expect(out).toContain('#define MBSERIAL_BAUD 115200')
    expect(out).toContain('#define MBSERIAL_SLAVE 1')
    expect(out).toContain('#define MBSERIAL')
    expect(out).toContain('#define MODBUS_ENABLED')
  })

  it('applies TCP `tcp_interface` default to Ethernet when only `enabled: true` is persisted', () => {
    const out = generateModbusDefines({ modbus_tcp: { enabled: true } })
    expect(out).toContain('#define MBTCP_ETHERNET')
    expect(out).not.toContain('MBTCP_WIFI')
  })

  it('always emits MBTCP_MAC/IP/DNS/GATEWAY/SUBNET when MBTCP is on (Baremetal.ino references them unconditionally)', () => {
    // Unset values land as `0` (single-byte arrays) so the sizeof()<4 cascade in
    // Baremetal.ino falls through to mbconfig_ethernet_iface(mac, NULL, ...).
    const out = generateModbusDefines({ modbus_tcp: { enabled: true, enable_dhcp: true } })
    expect(out).toContain('#define MBTCP_MAC 0')
    expect(out).toContain('#define MBTCP_IP 0')
    expect(out).toContain('#define MBTCP_DNS 0')
    expect(out).toContain('#define MBTCP_GATEWAY 0')
    expect(out).toContain('#define MBTCP_SUBNET 0')
  })

  it('honors custom RTU values (non-default baud, slave_id, interface)', () => {
    const out = generateModbusDefines({
      modbus_rtu: {
        enabled: true,
        rtu_interface: 'Serial1',
        rtu_baud_rate: '57600',
        rtu_slave_id: 42,
      },
    })
    expect(out).toContain('#define MBSERIAL_IFACE Serial1')
    expect(out).toContain('#define MBSERIAL_BAUD 57600')
    expect(out).toContain('#define MBSERIAL_SLAVE 42')
  })

  it('emits MBSERIAL_TXPIN only when the RS485 EN pin checkbox is on AND a pin value is set', () => {
    // Pin set but checkbox off → no MBSERIAL_TXPIN (matches screen visibility gate).
    const checkboxOff = generateModbusDefines({
      modbus_rtu: { enabled: true, enable_rs485_en_pin: false, rtu_rs485_en_pin: 'D2' },
    })
    expect(checkboxOff).not.toContain('MBSERIAL_TXPIN')

    // Checkbox on AND value set → emitted.
    const checkboxOn = generateModbusDefines({
      modbus_rtu: { enabled: true, enable_rs485_en_pin: true, rtu_rs485_en_pin: 'D2' },
    })
    expect(checkboxOn).toContain('#define MBSERIAL_TXPIN D2')

    // Checkbox on but pin empty → skipped (defensive — no garbage #define).
    const checkboxOnEmptyPin = generateModbusDefines({
      modbus_rtu: { enabled: true, enable_rs485_en_pin: true, rtu_rs485_en_pin: '' },
    })
    expect(checkboxOnEmptyPin).not.toContain('MBSERIAL_TXPIN')
  })

  it('emits the canonical TCP Ethernet block with static IP', () => {
    const out = generateModbusDefines({
      modbus_tcp: {
        enabled: true,
        tcp_interface: 'Ethernet',
        tcp_mac_address: 'de:ad:be:ef:fe:ed',
        enable_dhcp: false,
        ip_address: '192.168.1.100',
        dns: '8.8.8.8',
        gateway: '192.168.1.1',
        subnet: '255.255.255.0',
      },
    })
    expect(out).toContain('#define MBTCP_MAC 0xde, 0xad, 0xbe, 0xef, 0xfe, 0xed')
    expect(out).toContain('#define MBTCP_IP 192, 168, 1, 100')
    expect(out).toContain('#define MBTCP_DNS 8, 8, 8, 8')
    expect(out).toContain('#define MBTCP_GATEWAY 192, 168, 1, 1')
    expect(out).toContain('#define MBTCP_SUBNET 255, 255, 255, 0')
    expect(out).toContain('#define MBTCP_ETHERNET')
    expect(out).toContain('#define MBTCP')
    expect(out).toContain('#define MODBUS_ENABLED')
  })

  it('emits MBTCP_IP/DNS/GATEWAY/SUBNET as `0` placeholders when DHCP is enabled (sizeof<4 → DHCP path in Baremetal.ino)', () => {
    const out = generateModbusDefines({
      modbus_tcp: {
        enabled: true,
        tcp_interface: 'Ethernet',
        tcp_mac_address: 'de:ad:be:ef:fe:ed',
        enable_dhcp: true,
        // The user filled the static-host fields but then flipped DHCP on; the
        // static values are intentionally not used.
        ip_address: '192.168.1.100',
        gateway: '192.168.1.1',
        subnet: '255.255.255.0',
        dns: '8.8.8.8',
      },
    })
    expect(out).toContain('#define MBTCP_MAC 0xde, 0xad, 0xbe, 0xef, 0xfe, 0xed')
    expect(out).toContain('#define MBTCP_IP 0')
    expect(out).toContain('#define MBTCP_DNS 0')
    expect(out).toContain('#define MBTCP_GATEWAY 0')
    expect(out).toContain('#define MBTCP_SUBNET 0')
    expect(out).toContain('#define MBTCP_ETHERNET')
  })

  it('emits Wi-Fi specifics (SSID, PWD, MBTCP_WIFI) and omits MBTCP_ETHERNET when interface is Wi-Fi', () => {
    const out = generateModbusDefines({
      modbus_tcp: {
        enabled: true,
        tcp_interface: 'Wi-Fi',
        tcp_wifi_ssid: 'MyNetwork',
        tcp_wifi_password: 'super-secret',
        enable_dhcp: true,
      },
    })
    expect(out).toContain('#define MBTCP_SSID "MyNetwork"')
    expect(out).toContain('#define MBTCP_PWD "super-secret"')
    expect(out).toContain('#define MBTCP_WIFI')
    expect(out).not.toContain('MBTCP_ETHERNET')
  })

  it('emits MBTCP_MAC as `0` placeholder when the field is empty (boards with built-in MAC ignore it)', () => {
    const out = generateModbusDefines({
      modbus_tcp: { enabled: true, tcp_interface: 'Ethernet', enable_dhcp: true },
    })
    // Empty MAC → placeholder `0` so the .ino's `uint8_t mac[] = { MBTCP_MAC };`
    // compiles. Wi-Fi-equipped boards (ESP8266, ESP32, etc.) ignore the MAC
    // inside mbconfig_ethernet_iface, so the placeholder is harmless.
    expect(out).toContain('#define MBTCP_MAC 0')
    expect(out).toContain('#define MBTCP_ETHERNET')
  })

  it('combines RTU + TCP and emits MODBUS_ENABLED exactly once', () => {
    const out = generateModbusDefines({
      modbus_rtu: { enabled: true, rtu_interface: 'Serial', rtu_baud_rate: '9600', rtu_slave_id: 5 },
      modbus_tcp: { enabled: true, tcp_interface: 'Ethernet', enable_dhcp: true },
    })
    expect(out).toContain('#define MBSERIAL')
    expect(out).toContain('#define MBTCP')
    const occurrences = out.match(/#define MODBUS_ENABLED/g) ?? []
    expect(occurrences).toHaveLength(1)
  })

  it('defaults to MBTCP_ETHERNET when tcp_interface is missing', () => {
    const out = generateModbusDefines({
      modbus_tcp: { enabled: true, enable_dhcp: true },
    })
    expect(out).toContain('#define MBTCP_ETHERNET')
    expect(out).not.toContain('MBTCP_WIFI')
  })

  it('passes pre-formatted MAC literals through untouched (escape hatch for non-standard shapes)', () => {
    const out = generateModbusDefines({
      modbus_tcp: {
        enabled: true,
        tcp_interface: 'Ethernet',
        tcp_mac_address: '0xde, 0xad, 0xbe, 0xef, 0xfe, 0xed',
        enable_dhcp: true,
      },
    })
    expect(out).toContain('#define MBTCP_MAC 0xde, 0xad, 0xbe, 0xef, 0xfe, 0xed')
  })

  it('passes non-dotted IP strings through untouched', () => {
    const out = generateModbusDefines({
      modbus_tcp: {
        enabled: true,
        tcp_interface: 'Ethernet',
        enable_dhcp: false,
        ip_address: 'host.local',
      },
    })
    expect(out).toContain('#define MBTCP_IP host.local')
  })

  it('omits the heading entirely when both transports are explicitly disabled', () => {
    // Distinct from "neither block populated" — here we have data shapes but
    // the gating booleans are off. Output is still empty so defines.h stays
    // clean.
    const out = generateModbusDefines({
      modbus_rtu: { enabled: false, rtu_interface: 'Serial', rtu_baud_rate: '115200' },
      modbus_tcp: { enabled: false, tcp_interface: 'Ethernet', enable_dhcp: true },
    })
    expect(out).toBe('')
  })

  it('output always ends with a trailing newline (so callers can concatenate)', () => {
    const out = generateModbusDefines({
      modbus_rtu: { enabled: true, rtu_interface: 'Serial', rtu_baud_rate: '115200', rtu_slave_id: 1 },
    })
    expect(out.endsWith('\n')).toBe(true)
  })
})
