import { DEBUG_SLAVE, generateModbusDefines, narrowModbusTransports, selectModbusServer } from '../steps/modbus-defines'

/**
 * The `//Comms Configuration` block of `defines.h`.
 *
 * One rule underneath every case here: the project's `PLCServer` says WHAT is
 * served, and the board's package says what it is served OVER. Nothing reads a
 * pre-4.3.0 project's `modbus_rtu` / `modbus_tcp` sections -- 4.3.0 does not
 * carry configuration forward, and a project from before it creates its server
 * again.
 */

/** A server as the project stores it, RTU on the board's default UART. */
const rtuServer = {
  enabled: true,
  transports: ['rtu' as const],
  slaveId: 7,
  networkInterface: '0.0.0.0',
  port: 502,
}

/** The same, on a UART the server has to itself. */
const rtuOnSecondary = { ...rtuServer, serialPort: 'Serial2', baudRate: 19200 }

/** TCP only. */
const tcpServer = { enabled: true, transports: ['tcp' as const], networkInterface: '0.0.0.0', port: 502 }

describe('DEBUG_SLAVE', () => {
  it('is 1, the id every board already in the field answers on', () => {
    expect(DEBUG_SLAVE).toBe(1)
  })
})

describe('generateModbusDefines', () => {
  it('emits nothing without a server, because nothing else states what is served', () => {
    expect(generateModbusDefines({})).toBe('')
    expect(generateModbusDefines({ serial: { baud_rate: '19200' }, network: { enabled: true } })).toBe('')
  })

  it('emits nothing for a server that exists but is switched off', () => {
    expect(generateModbusDefines({}, 'Serial', { ...rtuServer, enabled: false })).toBe('')
  })

  it('emits nothing for a server that serves no transport', () => {
    expect(generateModbusDefines({}, 'Serial', { ...rtuServer, transports: [] })).toBe('')
  })

  it('emits the canonical RTU block on the default port', () => {
    const out = generateModbusDefines({ serial: { baud_rate: '19200' } }, 'Serial', rtuServer)
    expect(out).toContain('#define MBSERIAL_IFACE Serial')
    expect(out).toContain('#define MBSERIAL_BAUD 19200')
    expect(out).toContain('#define MBSERIAL_SLAVE 7')
    expect(out).toContain('#define MBSERIAL_SHARES_DEBUG_SERIAL')
    expect(out).toContain('#define MBSERIAL')
    expect(out).toContain('#define MODBUS_ENABLED')
    expect(out).not.toContain('MBSERIAL_ON_SECONDARY')
  })

  it('emits the secondary-UART shape when the server names another port', () => {
    const out = generateModbusDefines({ serial: { baud_rate: '115200' } }, 'Serial', rtuOnSecondary)
    expect(out).toContain('#define MBSERIAL_IFACE Serial2')
    expect(out).toContain('#define MBSERIAL_ON_SECONDARY')
    expect(out).not.toContain('MBSERIAL_SHARES_DEBUG_SERIAL')
  })

  it("honours a board whose default UART is not called 'Serial'", () => {
    const out = generateModbusDefines({}, 'SerialUSB', rtuServer)
    expect(out).toContain('#define MBSERIAL_IFACE SerialUSB')
    expect(out).toContain('#define MBSERIAL_SHARES_DEBUG_SERIAL')
  })

  it("carries the server's slave id on every port, including the editor's own", () => {
    // The firmware answers DEBUG_SLAVE alongside it there and routes by function
    // code, so the two share the UART without sharing an address.
    expect(generateModbusDefines({}, 'Serial', rtuServer)).toContain('#define MBSERIAL_SLAVE 7')
    expect(generateModbusDefines({}, 'Serial', rtuOnSecondary)).toContain('#define MBSERIAL_SLAVE 7')
  })

  it('falls back to slave id 1 when the project states none', () => {
    const { slaveId: _dropped, ...noId } = rtuServer
    expect(generateModbusDefines({}, 'Serial', noId)).toContain('#define MBSERIAL_SLAVE 1')
  })

  describe('the speed of the line', () => {
    it("takes the package's value on the default port, where the editor already listens", () => {
      const out = generateModbusDefines({ serial: { baud_rate: '19200' } }, 'Serial', { ...rtuServer, baudRate: 9600 })
      expect(out).toContain('#define MBSERIAL_BAUD 19200')
    })

    it("takes the server's value on a UART of its own", () => {
      const out = generateModbusDefines({ serial: { baud_rate: '115200' } }, 'Serial', rtuOnSecondary)
      expect(out).toContain('#define MBSERIAL_BAUD 19200')
    })

    it('falls back to 115200 when nothing states one', () => {
      expect(generateModbusDefines({}, 'Serial', rtuServer)).toContain('#define MBSERIAL_BAUD 115200')
    })
  })

  describe('the RS-485 driver-enable pin', () => {
    it('emits MBSERIAL_TXPIN when the board declares the pin is wired', () => {
      // Without it the transceiver never asserts DE and the board receives every
      // request and answers none.
      const state = { serial: { enable_rs485_en_pin: true, rs485_en_pin: '17' } }
      expect(generateModbusDefines(state, 'Serial', rtuServer)).toContain('#define MBSERIAL_TXPIN 17')
    })

    it('emits none when the checkbox is off, or on with no pin', () => {
      const off = { serial: { enable_rs485_en_pin: false, rs485_en_pin: '17' } }
      const blank = { serial: { enable_rs485_en_pin: true, rs485_en_pin: '' } }
      expect(generateModbusDefines(off, 'Serial', rtuServer)).not.toContain('MBSERIAL_TXPIN')
      expect(generateModbusDefines(blank, 'Serial', rtuServer)).not.toContain('MBSERIAL_TXPIN')
      expect(generateModbusDefines({}, 'Serial', rtuServer)).not.toContain('MBSERIAL_TXPIN')
    })
  })

  describe('the TCP listen port', () => {
    it('emits the port the server states', () => {
      expect(generateModbusDefines({ network: {} }, 'Serial', { ...tcpServer, port: 8502 })).toContain(
        '#define MBTCP_PORT 8502',
      )
    })

    it('falls back to 502, which is what the firmware listened on before it was configurable', () => {
      const { port: _dropped, ...noPort } = tcpServer
      expect(generateModbusDefines({ network: {} }, 'Serial', noPort)).toContain('#define MBTCP_PORT 502')
    })
  })

  describe('the network the TCP server answers over', () => {
    it('emits no MBTCP when the project turned the network off', () => {
      // Serving TCP over a network the project says to leave down produced
      // firmware that compiled MBTCP, called mbconfig_ethernet_iface and never
      // linked -- a healthy board that answers nothing.
      const out = generateModbusDefines({ network: { enabled: false } }, 'Serial', tcpServer)
      expect(out).toBe('')
    })

    it('still emits MBSERIAL when the network is off but RTU is on', () => {
      const both = { ...rtuServer, transports: ['rtu' as const, 'tcp' as const] }
      const out = generateModbusDefines({ network: { enabled: false } }, 'Serial', both)
      expect(out).toContain('#define MBSERIAL')
      expect(out).not.toContain('#define MBTCP\n')
    })

    it('builds TCP when the section exists but its toggle was never touched', () => {
      // The form layout persists only the fields the user touched, so a project
      // where someone typed an SSID and never touched the toggle has no
      // `enabled` at all; refusing that would trade one silent failure for another.
      const out = generateModbusDefines({ network: { wifi_ssid: 'planta' } }, 'Serial', tcpServer)
      expect(out).toContain('#define MBTCP')
    })

    it('emits the Ethernet block with a static address', () => {
      const state = {
        network: {
          enabled: true,
          interface: 'Ethernet' as const,
          mac_address: 'DE:AD:BE:EF:FE:ED',
          enable_dhcp: false,
          ip_address: '192.168.0.50',
          dns: '8.8.8.8',
          gateway: '192.168.0.1',
          subnet: '255.255.255.0',
        },
      }
      const out = generateModbusDefines(state, 'Serial', tcpServer)
      expect(out).toContain('#define MBTCP_ETHERNET')
      expect(out).toContain('#define MBTCP_MAC 0xde, 0xad, 0xbe, 0xef, 0xfe, 0xed')
      expect(out).toContain('#define MBTCP_IP 192, 168, 0, 50')
      expect(out).toContain('#define MBTCP_DNS 8, 8, 8, 8')
      expect(out).toContain('#define MBTCP_GATEWAY 192, 168, 0, 1')
      expect(out).toContain('#define MBTCP_SUBNET 255, 255, 255, 0')
      expect(out).not.toContain('MBTCP_WIFI')
    })

    it('emits address placeholders under DHCP, which is how the firmware selects it', () => {
      // Baremetal.ino references five byte arrays unconditionally inside the
      // `#ifdef MBTCP` block and uses `sizeof(arr) < 4` as a compile-time
      // DHCP-vs-static selector. A missing macro fails compilation; a single-byte
      // `0` is how "unset" is signalled.
      const state = { network: { enabled: true, enable_dhcp: true, ip_address: '192.168.0.50' } }
      const out = generateModbusDefines(state, 'Serial', tcpServer)
      expect(out).toContain('#define MBTCP_IP 0')
      expect(out).toContain('#define MBTCP_DNS 0')
      expect(out).toContain('#define MBTCP_GATEWAY 0')
      expect(out).toContain('#define MBTCP_SUBNET 0')
    })

    it('always emits all five, even with nothing configured', () => {
      const out = generateModbusDefines({ network: {} }, 'Serial', tcpServer)
      for (const macro of ['MBTCP_MAC', 'MBTCP_IP', 'MBTCP_DNS', 'MBTCP_GATEWAY', 'MBTCP_SUBNET']) {
        expect(out).toContain(`#define ${macro} 0`)
      }
    })

    it('emits the Wi-Fi specifics and drops MBTCP_ETHERNET', () => {
      const state = {
        network: { enabled: true, interface: 'Wi-Fi' as const, wifi_ssid: 'planta', wifi_password: 's3cr3t' },
      }
      const out = generateModbusDefines(state, 'Serial', tcpServer)
      expect(out).toContain('#define MBTCP_SSID "planta"')
      expect(out).toContain('#define MBTCP_PWD "s3cr3t"')
      expect(out).toContain('#define MBTCP_WIFI')
      expect(out).not.toContain('MBTCP_ETHERNET')
    })

    it('defaults to Ethernet when the section names no interface', () => {
      expect(generateModbusDefines({ network: { enabled: true } }, 'Serial', tcpServer)).toContain(
        '#define MBTCP_ETHERNET',
      )
    })

    it('passes an already-formatted MAC or IP through untouched', () => {
      // Escape hatch for shapes the formatter would mangle.
      const state = { network: { enabled: true, mac_address: '0xAA,0xBB,0xCC,0xDD,0xEE,0xFF', ip_address: 'DHCP' } }
      const out = generateModbusDefines(state, 'Serial', tcpServer)
      expect(out).toContain('#define MBTCP_MAC 0xAA,0xBB,0xCC,0xDD,0xEE,0xFF')
      expect(out).toContain('#define MBTCP_IP DHCP')
    })
  })

  it('combines RTU and TCP under one MODBUS_ENABLED', () => {
    const both = { ...rtuServer, transports: ['rtu' as const, 'tcp' as const] }
    const out = generateModbusDefines({ network: { enabled: true } }, 'Serial', both)
    expect(out).toContain('#define MBSERIAL')
    expect(out).toContain('#define MBTCP')
    expect(out.match(/#define MODBUS_ENABLED/g)).toHaveLength(1)
  })

  it('ends with a trailing newline so callers can concatenate', () => {
    expect(generateModbusDefines({}, 'Serial', rtuServer).endsWith('\n')).toBe(true)
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

  it('finds nothing in a server that serves nothing', () => {
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

  it('prefers the serving one when a disabled server comes first', () => {
    const selection = selectModbusServer([server('mb1', ['tcp'], false), server('mb2', ['rtu'])])
    expect(selection.server).toMatchObject({ transports: ['rtu'] })
  })
})

/**
 * Deleting the server has to stop Modbus. It did not, for one release of this
 * branch: the emitter fell back to the board's screen sections, which nothing
 * ever cleared, so a board kept serving a configuration the user had removed.
 * That fallback is gone with the rest of the pre-4.3.0 compatibility.
 */
describe('a server the user deleted', () => {
  it('stops Modbus, whatever the board screens still hold', () => {
    const { server } = selectModbusServer([])
    const leftovers = {
      serial: { baud_rate: '19200', enable_rs485_en_pin: true, rs485_en_pin: '17' },
      network: { enabled: true, wifi_ssid: 'planta' },
    }
    expect(generateModbusDefines(leftovers, 'Serial', server)).toBe('')
  })
})

/**
 * A board can only serve what it has a carrier for.
 *
 * The project states transports and the board states carriers; until these,
 * only the screen intersected them, and the emitter took the project's word.
 * A server seeded `['tcp']` on a board with no network therefore compiled
 * `MBTCP` into a firmware with no stack and no `MBSERIAL` beside it.
 */
describe('narrowModbusTransports', () => {
  const server = { enabled: true, transports: ['rtu', 'tcp'] as ('rtu' | 'tcp')[], slaveId: 7 }

  it('returns the server untouched when the board carries everything asked for', () => {
    const onDropped = jest.fn()
    expect(narrowModbusTransports(server, ['rtu', 'tcp'], onDropped)).toBe(server)
    expect(onDropped).not.toHaveBeenCalled()
  })

  it('drops the transport the board cannot carry and keeps the rest', () => {
    const onDropped = jest.fn()
    const narrowed = narrowModbusTransports(server, ['rtu'], onDropped)

    expect(narrowed?.transports).toEqual(['rtu'])
    // Everything else about the server survives -- the slave id is the user's.
    expect(narrowed?.slaveId).toBe(7)
    expect(onDropped).toHaveBeenCalledWith(['tcp'])
  })

  it('reports the drop rather than swallowing it', () => {
    // On a microcontroller there is no console. If the build does not say the
    // transport was left out, nothing ever will.
    const onDropped = jest.fn()
    narrowModbusTransports({ enabled: true, transports: ['tcp'] }, ['rtu'], onDropped)
    expect(onDropped).toHaveBeenCalledWith(['tcp'])
  })

  it('yields no server at all when nothing survives', () => {
    // A server that serves no transport is not a server, and the emitter must
    // see `undefined` rather than an empty list it would read as "no Modbus".
    expect(narrowModbusTransports({ enabled: true, transports: ['tcp'] }, ['rtu'], jest.fn())).toBeUndefined()
  })

  it('passes an absent server straight through', () => {
    expect(narrowModbusTransports(undefined, ['rtu'], jest.fn())).toBeUndefined()
  })

  it('emits nothing once a TCP-only server is narrowed away on a board with no network', () => {
    // The bench failure, end to end: this exact input used to produce the full
    // MBTCP block -- MBTCP_ETHERNET into a firmware with no stack.
    const narrowed = narrowModbusTransports({ enabled: true, transports: ['tcp'] }, ['rtu'], jest.fn())
    expect(generateModbusDefines({}, 'Serial', narrowed)).toBe('')
  })
})
