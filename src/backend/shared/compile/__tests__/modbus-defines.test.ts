import {
  DEBUG_SLAVE,
  DEFAULT_DEBUG_BAUD,
  generateModbusDefines,
  resolveDebugBaud,
  selectModbusServer,
} from '../steps/modbus-defines'

/**
 * The baud the always-on debugger answers on. It has to agree with the rate the
 * editor dials, and the two are derived in different places — so these pin the
 * derivation against the shapes real projects actually persist.
 */
describe('resolveDebugBaud', () => {
  it('prefers an explicit `serial` section when a package declares one', () => {
    expect(resolveDebugBaud({ serial: { baud_rate: '57600' }, modbus_rtu: { rtu_baud_rate: '9600' } })).toBe('57600')
  })

  it('falls back to the RTU section for a package published before `serial` existed', () => {
    expect(resolveDebugBaud({ modbus_rtu: { rtu_baud_rate: '9600' } })).toBe('9600')
  })

  it('does not care which UART the RTU took', () => {
    // The debugger is on the default port either way, and that port's speed is
    // the package's to state. Deriving it from the RTU's choice was what welded
    // the editor's link to a Modbus setting.
    const onDefault = resolveDebugBaud({ serial: { baud_rate: '19200', modbus_port: 'Serial' } })
    const onSecondary = resolveDebugBaud({ serial: { baud_rate: '19200', modbus_port: 'Serial1' } })
    expect(onDefault).toBe('19200')
    expect(onSecondary).toBe('19200')
  })

  it('falls back for an empty project', () => {
    expect(resolveDebugBaud({})).toBe(DEFAULT_DEBUG_BAUD)
  })
})

/**
 * The slave id the editor frames on. It is a constant rather than a setting
 * because the firmware answers it alongside the Modbus server's id and routes by
 * function code, so nothing a project can express moves the editor's link. The
 * value itself is load-bearing: every board already in the field answers 1.
 */
describe('DEBUG_SLAVE', () => {
  it('is 1, the id every board already in the field answers on', () => {
    expect(DEBUG_SLAVE).toBe(1)
  })
})

describe('generateModbusDefines', () => {
  it('returns an empty string when neither RTU nor TCP is enabled', () => {
    expect(generateModbusDefines({})).toBe('')
    expect(generateModbusDefines({ modbus_rtu: {}, modbus_tcp: {} })).toBe('')
    expect(generateModbusDefines({ modbus_rtu: { enabled: false }, modbus_tcp: { enabled: false } })).toBe('')
  })

  it('emits the canonical RTU block for a project that predates the server', () => {
    // Never opened by an editor that promotes the screen state, so the section
    // is still the only statement of what is served. It has to compile to the
    // same firmware it compiled to yesterday.
    const out = generateModbusDefines({
      serial: { baud_rate: '115200' },
      modbus_rtu: { enabled: true },
    })
    expect(out).toBe(
      [
        '//Comms Configuration',
        '#define MBSERIAL_IFACE Serial',
        '#define MBSERIAL_BAUD 115200',
        '#define MBSERIAL_SLAVE 1',
        '#define MBSERIAL_SHARES_DEBUG_SERIAL',
        '#define MBSERIAL',
        '#define MODBUS_ENABLED',
        '',
      ].join('\n'),
    )
  })

  it('lets the project server decide what is served', () => {
    const out = generateModbusDefines({ serial: { baud_rate: '9600' } }, 'Serial', {
      transports: ['rtu'],
      serialPort: 'Serial1',
      slaveId: 7,
    })
    expect(out).toContain('#define MBSERIAL_IFACE Serial1')
    expect(out).toContain('#define MBSERIAL_SLAVE 7')
    expect(out).toContain('#define MBSERIAL_ON_SECONDARY')
  })

  it('serves nothing when the server exists but is switched off', () => {
    expect(
      generateModbusDefines({ modbus_rtu: { enabled: true } }, 'Serial', {
        enabled: false,
        transports: ['rtu'],
      }),
    ).toBe('')
  })

  it('takes the server over the stale section it replaced', () => {
    // A migrated project still carries the old section, because the migration
    // copies rather than moves. The server is what counts.
    const out = generateModbusDefines({ modbus_rtu: { enabled: true } }, 'Serial', { transports: ['tcp'] })
    expect(out).not.toContain('#define MBSERIAL')
    expect(out).toContain('#define MBTCP')
  })

  it('honours the server slave id on the default port, where the editor also listens', () => {
    // The firmware answers DEBUG_SLAVE there too, routed by function code, so
    // the server keeps its own address on the UART the editor is using. This
    // used to be overridden with the editor's id, which is what made the field
    // read-only on that port.
    const out = generateModbusDefines({ serial: { baud_rate: '9600' } }, 'Serial', {
      transports: ['rtu'],
      serialPort: 'Serial',
      slaveId: 7,
    })
    expect(out).toContain('#define MBSERIAL_SLAVE 7')
    expect(out).toContain('#define MBSERIAL_SHARES_DEBUG_SERIAL')
  })

  it('honours the server slave id on a UART of its own', () => {
    const out = generateModbusDefines({ serial: { baud_rate: '9600' } }, 'Serial', {
      transports: ['rtu'],
      serialPort: 'Serial1',
      slaveId: 7,
    })
    expect(out).toContain('#define MBSERIAL_SLAVE 7')
  })

  it('honors a non-default `defaultSerial` when deciding the shares flag', () => {
    const out = generateModbusDefines({ serial: { baud_rate: '9600' } }, 'Serial1', {
      transports: ['rtu'],
      serialPort: 'Serial1',
    })
    expect(out).toContain('#define MBSERIAL_IFACE Serial1')
    expect(out).toContain('#define MBSERIAL_BAUD 9600')
    expect(out).toContain('#define MBSERIAL_SHARES_DEBUG_SERIAL')
  })

  it('reads TCP network config from the network section', () => {
    const out = generateModbusDefines({
      network: {
        interface: 'Wi-Fi',
        wifi_ssid: 'MyNet',
        wifi_password: 'super-secret',
        enable_dhcp: true,
      },
      modbus_tcp: { enabled: true },
    })
    expect(out).toContain('#define MBTCP_SSID "MyNet"')
    expect(out).toContain('#define MBTCP_PWD "super-secret"')
    expect(out).toContain('#define MBTCP_WIFI')
  })

  it('takes the RTU port, its baud and the RS485 pin from the serial section', () => {
    // The physical layer is the package's: which UART, how fast, which pin
    // drives the RS-485 transceiver. The server says only that RTU is served.
    const out = generateModbusDefines(
      {
        serial: {
          baud_rate: '9600',
          modbus_port: 'Serial2',
          modbus_baud_rate: '19200',
          enable_rs485_en_pin: true,
          rs485_en_pin: '4',
        },
      },
      'Serial',
      { transports: ['rtu'], slaveId: 7 },
    )
    expect(out).toContain('#define MBSERIAL_IFACE Serial2')
    expect(out).toContain('#define MBSERIAL_BAUD 19200')
    expect(out).toContain('#define MBSERIAL_SLAVE 7')
    expect(out).toContain('#define MBSERIAL_TXPIN 4')
    expect(out).toContain('#define MBSERIAL_ON_SECONDARY')
  })

  it('shares the default port baud when the RTU stays on it', () => {
    const out = generateModbusDefines({
      serial: { baud_rate: '9600', modbus_port: 'Serial', modbus_baud_rate: '19200' },
      modbus_rtu: { enabled: true },
    })
    // modbus_baud_rate belongs to the SECONDARY port; on the default one the
    // debugger and the RTU are the same line and share one speed.
    expect(out).toContain('#define MBSERIAL_BAUD 9600')
    expect(out).toContain('#define MBSERIAL_SHARES_DEBUG_SERIAL')
  })

  it('emits the listen port the server states', () => {
    const out = generateModbusDefines({ network: {} }, 'Serial', { transports: ['tcp'], port: 5020 })
    expect(out).toContain('#define MBTCP_PORT 5020')
  })

  it('falls back to 502, which is what the firmware listened on before the port was configurable', () => {
    const out = generateModbusDefines({ modbus_tcp: { enabled: true } })
    expect(out).toContain('#define MBTCP_PORT 502')
  })

  it('emits no MBTCP when the network section is explicitly disabled', () => {
    // Modbus TCP cannot come up without a network. Emitting MBTCP anyway
    // produced firmware that called mbconfig_ethernet_iface and never linked —
    // a healthy board that answers nothing, which reads as broken hardware.
    const out = generateModbusDefines({
      network: { enabled: false, interface: 'Wi-Fi', wifi_ssid: 'MyNet' },
      modbus_tcp: { enabled: true },
    })
    expect(out).not.toContain('#define MBTCP')
    expect(out).not.toContain('MBTCP_WIFI')
    expect(out).toBe('')
  })

  it('still emits MBSERIAL when the network is off but RTU is on', () => {
    // The network gate is TCP's alone; RTU has nothing to do with it.
    const out = generateModbusDefines({
      network: { enabled: false },
      modbus_rtu: { enabled: true },
      modbus_tcp: { enabled: true },
    })
    expect(out).toContain('#define MBSERIAL')
    expect(out).toContain('#define MODBUS_ENABLED')
    expect(out).not.toContain('#define MBTCP')
  })

  it('builds TCP when the network section exists but its toggle was never touched', () => {
    // The form layout persists only fields the user edited, so someone who
    // typed an SSID without touching "Enable Network" has no `enabled` key.
    // Only an explicit `false` blocks; absence must not.
    const out = generateModbusDefines({
      network: { wifi_ssid: 'MyNet', interface: 'Wi-Fi' },
      modbus_tcp: { enabled: true },
    })
    expect(out).toContain('#define MBTCP')
    expect(out).toContain('#define MBTCP_SSID "MyNet"')
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

  it('honors custom RTU values (non-default baud, slave id, UART)', () => {
    const out = generateModbusDefines({ serial: { modbus_port: 'Serial1', modbus_baud_rate: '57600' } }, 'Serial', {
      transports: ['rtu'],
      slaveId: 42,
    })
    expect(out).toContain('#define MBSERIAL_IFACE Serial1')
    expect(out).toContain('#define MBSERIAL_BAUD 57600')
    expect(out).toContain('#define MBSERIAL_SLAVE 42')
  })

  it('emits MBSERIAL_TXPIN only when the RS485 EN pin checkbox is on AND a pin value is set', () => {
    const rtu = { transports: ['rtu' as const] }

    // Pin set but checkbox off → no MBSERIAL_TXPIN (matches screen visibility gate).
    const checkboxOff = generateModbusDefines(
      { serial: { enable_rs485_en_pin: false, rs485_en_pin: 'D2' } },
      'Serial',
      rtu,
    )
    expect(checkboxOff).not.toContain('MBSERIAL_TXPIN')

    // Checkbox on AND value set → emitted.
    const checkboxOn = generateModbusDefines(
      { serial: { enable_rs485_en_pin: true, rs485_en_pin: 'D2' } },
      'Serial',
      rtu,
    )
    expect(checkboxOn).toContain('#define MBSERIAL_TXPIN D2')

    // Checkbox on but pin empty → skipped (defensive — no garbage #define).
    const checkboxOnEmptyPin = generateModbusDefines(
      { serial: { enable_rs485_en_pin: true, rs485_en_pin: '' } },
      'Serial',
      rtu,
    )
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
      serial: { baud_rate: '9600' },
      modbus_rtu: { enabled: true },
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
      modbus_rtu: { enabled: false },
      modbus_tcp: { enabled: false, tcp_interface: 'Ethernet', enable_dhcp: true },
    })
    expect(out).toBe('')
  })

  it('output always ends with a trailing newline (so callers can concatenate)', () => {
    const out = generateModbusDefines({
      serial: { baud_rate: '115200' },
      modbus_rtu: { enabled: true },
    })
    expect(out.endsWith('\n')).toBe(true)
  })
})

/**
 * A firmware build serves exactly one Modbus slave. The editor lets a project
 * carry several on purpose -- it moves between targets -- so the refusal has to
 * land where a single answer is actually required, and it has to name the
 * servers rather than state a number.
 */
describe('selectModbusServer', () => {
  const server = (name: string, transports: ('rtu' | 'tcp')[], enabled = true) => ({
    name,
    protocol: 'modbus-tcp',
    modbusSlaveConfig: { enabled, transports, networkInterface: '0.0.0.0', port: 502 },
  })

  it('finds nothing in a project with no servers', () => {
    expect(selectModbusServer(undefined)).toEqual({})
    expect(selectModbusServer([])).toEqual({})
  })

  it('ignores a server that serves nothing', () => {
    expect(selectModbusServer([server('mb1', [])])).toEqual({})
    expect(selectModbusServer([server('mb1', ['rtu'], false)])).toEqual({})
  })

  it('ignores a server of another protocol', () => {
    expect(selectModbusServer([{ name: 'opc', protocol: 'opcua' }])).toEqual({})
  })

  it('returns the one server that is serving', () => {
    expect(selectModbusServer([server('mb1', ['rtu', 'tcp'])]).server).toMatchObject({ transports: ['rtu', 'tcp'] })
  })

  it('names every server in conflict, so the user knows which to turn off', () => {
    const selection = selectModbusServer([server('mb1', ['rtu']), server('mb2', ['tcp'])])
    expect(selection.conflict).toEqual(['mb1', 'mb2'])
    expect(selection.server).toBeUndefined()
  })

  it('does not count a disabled server towards the conflict', () => {
    const selection = selectModbusServer([server('mb1', ['rtu']), server('mb2', ['tcp'], false)])
    expect(selection.conflict).toBeUndefined()
    expect(selection.server).toMatchObject({ transports: ['rtu'] })
  })
})
