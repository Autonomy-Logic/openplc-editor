/**
 * The Modbus-server profile resolver.
 *
 * What is worth pinning here is the set of facts the unified screen would
 * otherwise get wrong, each of which is a real hardware behaviour rather than
 * a UI preference:
 *
 *  - a baremetal board has no `%MX` segment, so a `%MX` row would name storage
 *    that does not exist (`init_mbregs` takes MAX_DIGITAL_OUTPUT as the coil
 *    count, and `arduino/openplc.h` declares no `bool_memory`);
 *  - its TCP port is hard-coded 502 in `modbus_tcp.cpp`, so a port input would
 *    be a control that changes nothing;
 *  - its buffer sizes are compile-time constants that also size the IEC
 *    pointer arrays, so they are read-only until the firmware says otherwise;
 *  - and, most consequentially, a board whose VPP carries a Modbus screen must
 *    resolve as a baremetal target even though its capabilities also report
 *    `modbusTcpServer`, because what that decides is which fields the target
 *    lets the user set — a fixed port and firmware-sized buffers, not the
 *    project's own.
 */

import { resolveModbusServerProfile } from '../resolve'

/** Firmware sizes a non-AVR arduino board compiles with (arduino/openplc.h). */
const arduinoBoard = (overrides: Record<string, unknown> = {}) => ({
  compiler: 'arduino-cli',
  vpp: { screens: { Serial: {}, Network: {}, Modbus: {} } },
  // Three UARTs, like an ESP32 WROOM: one carries the editor link, two are free.
  serialPorts: ['Serial', 'Serial1', 'Serial2'],
  defaultSerial: 'Serial',
  ...overrides,
})

describe('resolveModbusServerProfile', () => {
  it('answers "no server" for a board that does not resolve', () => {
    expect(resolveModbusServerProfile(undefined).transports).toEqual([])
    expect(resolveModbusServerProfile(null).transports).toEqual([])
  })

  it('answers "no server" for Runtime v3, which hosts none', () => {
    // v3 predates the slave plugin; its capability block says so.
    const profile = resolveModbusServerProfile({ capabilities: { modbusTcpServer: false } })
    expect(profile.transports).toEqual([])
    expect(profile.transports).toEqual([])
  })

  describe('Runtime v4', () => {
    const profile = resolveModbusServerProfile({ compiler: 'openplc-compiler' })

    it('reads and writes the project-scoped PLCServer', () => {
      expect(profile.configurablePort).toBe(true)
    })

    it('offers TCP only — the slave plugin is a listener with no serial path', () => {
      expect(profile.transports).toEqual(['tcp'])
    })

    it('exposes every segment, %MX included', () => {
      expect(profile.segments).toEqual(['QW', 'MW', 'MD', 'ML', 'QX', 'MX', 'IX', 'IW'])
    })

    it('lets the user size the buffers, pick the port and pick the bind address', () => {
      expect(profile.configurableBuffers).toBe(true)
      expect(profile.configurablePort).toBe(true)
      expect(profile.configurableBindAddress).toBe(true)
    })

    it('derives no counts — they come from the saved server, not the board', () => {
      expect(profile.derivedCounts).toBeNull()
    })

    it('links to no vendor screens', () => {
      expect(profile.vppScreens).toEqual({})
    })
  })

  describe('baremetal', () => {
    const profile = resolveModbusServerProfile(arduinoBoard())

    it('reads and writes the board-scoped vendor screen state', () => {
      expect(profile.configurablePort).toBe(false)
    })

    it('offers both transports', () => {
      expect(profile.transports).toEqual(['rtu', 'tcp'])
    })

    it('omits %MX — the firmware has no bool_memory bank', () => {
      expect(profile.segments).not.toContain('MX')
      expect(profile.segments).toEqual(['QW', 'MW', 'MD', 'ML', 'QX', 'IX', 'IW'])
    })

    it('keeps buffers, port and bind address out of the user hands', () => {
      expect(profile.configurableBuffers).toBe(false)
      expect(profile.configurablePort).toBe(false)
      expect(profile.configurableBindAddress).toBe(false)
    })

    it('reports the port modbus_tcp.cpp hard-codes', () => {
      expect(profile.fixedPort).toBe(502)
    })

    it('reports no buffer counts at all', () => {
      // They are chosen by an MCU-family macro inside a header the build never
      // reports back, and nothing in the project declares them. Sizing the I/O
      // image, and therefore knowing its size, belongs to DOPE-615; this screen
      // says so rather than showing a map it would be guessing at.
      expect(profile.derivedCounts).toBeNull()
      expect(profile.minCounts).toBeNull()
      expect(profile.maxCounts).toBeNull()
    })

    it('links out to the serial and network screens the package ships', () => {
      expect(profile.vppScreens).toEqual({ serial: 'Serial', network: 'Network', modbus: 'Modbus' })
    })
  })

  it('offers Modbus RTU on a board whose only UART carries the editor connection', () => {
    // The default port answers the debugger, the status and the licensing
    // function codes, and it is where the USB cable lands. The firmware serves
    // the debugger and the register table there together, so using it for RTU
    // is a legitimate choice: which of the two the user talks to at a given
    // moment is theirs to arrange. Refusing it was the editor deciding for them.
    const profile = resolveModbusServerProfile(arduinoBoard({ serialPorts: ['Serial'] }))
    expect(profile.transports).toContain('rtu')
  })

  it('carries the board UART set and the editor port, for the picker and the read-only rule', () => {
    const profile = resolveModbusServerProfile(
      arduinoBoard({ serialPorts: ['SerialUSB', 'Serial1'], defaultSerial: 'SerialUSB' }),
    )
    expect(profile.transports).toContain('rtu')
    expect(profile.serialPorts).toEqual(['SerialUSB', 'Serial1'])
    expect(profile.defaultSerial).toBe('SerialUSB')
  })

  it('offers RTU on a board that declares no UART set at all', () => {
    // 13 boards do not declare one, because their variants were not confirmed
    // against hardware. Refusing RTU there would remove a configuration that
    // works today; the picker falls back to its static list.
    const profile = resolveModbusServerProfile(arduinoBoard({ serialPorts: undefined }))
    expect(profile.transports).toContain('rtu')
  })

  it('stays a baremetal profile even when the board also reports modbusTcpServer', () => {
    // A migrated arduino board reports both. Resolving it as `plc-server`
    // would read an empty PLCServer and present a board whose Modbus is
    // configured as though it were not.
    const profile = resolveModbusServerProfile(arduinoBoard({ capabilities: { modbusTcpServer: true } }))
    expect(profile.configurablePort).toBe(false)
  })

  it('offers only RTU when the board declares no TCP', () => {
    const profile = resolveModbusServerProfile(arduinoBoard({ capabilities: { modbusTcpServer: false } }))
    expect(profile.transports).toEqual(['rtu'])
  })

  it('offers only TCP when the board declares no RTU', () => {
    const profile = resolveModbusServerProfile(arduinoBoard({ capabilities: { modbusRtuServer: false } }))
    expect(profile.transports).toEqual(['tcp'])
  })

  it('answers "no server" for a board with a Modbus screen but neither transport', () => {
    const profile = resolveModbusServerProfile(
      arduinoBoard({ capabilities: { modbusRtuServer: false, modbusTcpServer: false } }),
    )
    expect(profile.transports).toEqual([])
  })

  describe('a package that has not been migrated', () => {
    // Stage-by-stage rollout means an installed VPP may still carry the single
    // pre-split screen. Only the links differ.
    const profile = resolveModbusServerProfile(arduinoBoard({ vpp: { screens: { Modbus: {} } } }))

    it('still resolves as a baremetal target', () => {
      expect(profile.configurablePort).toBe(false)
    })

    it('reports no serial or network screen to link to', () => {
      expect(profile.vppScreens.serial).toBeUndefined()
      expect(profile.vppScreens.network).toBeUndefined()
      expect(profile.vppScreens.modbus).toBe('Modbus')
    })
  })

  it('matches screen names case-insensitively', () => {
    const profile = resolveModbusServerProfile(
      arduinoBoard({ vpp: { screens: { serial: {}, NETWORK: {}, modbus: {} } } }),
    )
    expect(profile.vppScreens).toEqual({ serial: 'serial', network: 'NETWORK', modbus: 'modbus' })
  })

  it('is still baremetal with no vpp metadata at all', () => {
    // The compiler decides, not the package. A board recognised by a screen
    // the package happens to ship would stop being baremetal the day that
    // screen had nothing left to hold.
    const profile = resolveModbusServerProfile({ compiler: 'arduino-cli' })
    expect(profile.configurablePort).toBe(false)
    expect(profile.fixedPort).toBe(502)
    expect(profile.derivedCounts).toBeNull()
  })

  it('treats the Simulator as a plc-server target so a v4 project keeps its config', () => {
    const profile = resolveModbusServerProfile({ compiler: 'simulator' })
    expect(profile.configurablePort).toBe(true)
    expect(profile.transports).toEqual(['tcp'])
  })
})

/**
 * A package published before 4.4.0 declares no `io` block. The screen used to
 * answer that by showing nothing — no counts, no address map — on a board that
 * plainly has both, which is what a user hits the moment they upgrade the
 * editor without updating their packages.
 */
