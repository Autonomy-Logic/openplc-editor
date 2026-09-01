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
 *    resolve to the vendor-screen store even though its capabilities also
 *    report `modbusTcpServer` — reading a PLCServer instead would silently
 *    ignore every existing project's configuration.
 */

import { resolveModbusServerProfile } from '../resolve'

/** Firmware sizes a non-AVR arduino board compiles with (arduino/openplc.h). */
const IO = {
  digitalInput: 56,
  digitalOutput: 56,
  analogInput: 32,
  analogOutput: 32,
  memoryWord: 20,
  memoryDword: 20,
  memoryLword: 20,
}

const arduinoBoard = (overrides: Record<string, unknown> = {}) => ({
  compiler: 'arduino-cli',
  vpp: { screens: { Serial: {}, Network: {}, Modbus: {} } },
  io: IO,
  ...overrides,
})

describe('resolveModbusServerProfile', () => {
  it('answers "no server" for a board that does not resolve', () => {
    expect(resolveModbusServerProfile(undefined).store).toBe('none')
    expect(resolveModbusServerProfile(null).store).toBe('none')
  })

  it('answers "no server" for Runtime v3, which hosts none', () => {
    // v3 predates the slave plugin; its capability block says so.
    const profile = resolveModbusServerProfile({ capabilities: { modbusTcpServer: false } })
    expect(profile.store).toBe('none')
    expect(profile.transports).toEqual([])
  })

  describe('Runtime v4 (plc-server store)', () => {
    const profile = resolveModbusServerProfile({ compiler: 'openplc-compiler' })

    it('reads and writes the project-scoped PLCServer', () => {
      expect(profile.store).toBe('plc-server')
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

  describe('baremetal (vendor-screen store)', () => {
    const profile = resolveModbusServerProfile(arduinoBoard())

    it('reads and writes the board-scoped vendor screen state', () => {
      expect(profile.store).toBe('vendor-screen')
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

    it('maps the declared firmware sizes onto IEC segments the way init_mbregs does', () => {
      // Baremetal.ino:247 — holding is %QW then %MW, the 32/64-bit banks are
      // %MD and %ML, coils are %QX alone, input status %IX, input regs %IW.
      expect(profile.derivedCounts).toEqual({
        QW: 32,
        MW: 20,
        MD: 20,
        ML: 20,
        QX: 56,
        MX: 0,
        IX: 56,
        IW: 32,
      })
    })

    it('links out to the serial and network screens the package ships', () => {
      expect(profile.vppScreens).toEqual({ serial: 'Serial', network: 'Network', modbus: 'Modbus' })
    })
  })

  it('wins over the plc-server path even when the board also reports modbusTcpServer', () => {
    // A migrated arduino board reports both. Resolving it as `plc-server`
    // would read an empty PLCServer and present a board whose Modbus is
    // configured as though it were not.
    const profile = resolveModbusServerProfile(arduinoBoard({ capabilities: { modbusTcpServer: true } }))
    expect(profile.store).toBe('vendor-screen')
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
    expect(profile.store).toBe('none')
  })

  describe('a package that has not been migrated', () => {
    // Stage-by-stage rollout means an installed VPP may still carry the single
    // pre-split screen. The screen is still the store; only the links differ.
    const profile = resolveModbusServerProfile(
      arduinoBoard({ vpp: { screens: { Modbus: {} } } }),
    )

    it('still resolves to the vendor-screen store', () => {
      expect(profile.store).toBe('vendor-screen')
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

  it('reports no counts when the board declares no io block', () => {
    const profile = resolveModbusServerProfile(arduinoBoard({ io: undefined }))
    expect(profile.derivedCounts).toBeNull()
  })

  it('reports no counts when the io block is only partly declared', () => {
    // Filling the gaps with zeros would push every later segment onto the
    // wrong Modbus offset, and the map would be confidently wrong.
    const profile = resolveModbusServerProfile(arduinoBoard({ io: { digitalInput: 8, digitalOutput: 8 } }))
    expect(profile.derivedCounts).toBeNull()
  })

  it('reports no counts when a board has no vpp metadata at all', () => {
    const profile = resolveModbusServerProfile({ compiler: 'arduino-cli' })
    // No Modbus screen → not a vendor-screen target; arduino has no PLCServer
    // path either, so there is nothing to configure.
    expect(profile.store).toBe('plc-server')
    expect(profile.derivedCounts).toBeNull()
  })

  it('treats the Simulator as a plc-server target so a v4 project keeps its config', () => {
    const profile = resolveModbusServerProfile({ compiler: 'simulator' })
    expect(profile.store).toBe('plc-server')
    expect(profile.transports).toEqual(['tcp'])
  })
})
