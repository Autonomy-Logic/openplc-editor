import {
  ARDUINO_CLI_CAPABILITIES,
  RUNTIME_V3_CAPABILITIES,
  RUNTIME_V4_CAPABILITIES,
  SIMULATOR_CAPABILITIES,
} from '../presets'
import { resolveTargetCapabilities } from '../resolve'
import type { TargetCapabilities } from '../types'

describe('resolveTargetCapabilities', () => {
  it('returns an empty (everything-disabled) block when no board info is provided', () => {
    const caps = resolveTargetCapabilities(undefined)
    expect(caps.pinMapping).toBe(false)
    expect(caps.vppIo).toBe(false)
    expect(caps.modbusTcpRemote).toBe(false)
    expect(caps.debuggerTransports).toEqual([])
  })

  // The presets carry no nested `opcua` / `s7` block; the resolver fills them
  // whenever the matching server flag is on, so a target that declares nothing
  // still gets a usable profile. Compared field-by-field rather than with
  // toEqual for that reason.
  it('returns Simulator preset for compiler="simulator"', () => {
    expect(resolveTargetCapabilities({ compiler: 'simulator' })).toMatchObject(SIMULATOR_CAPABILITIES)
  })

  it('returns Runtime v4 preset for compiler="openplc-compiler" (non-VPP)', () => {
    expect(resolveTargetCapabilities({ compiler: 'openplc-compiler' })).toMatchObject(RUNTIME_V4_CAPABILITIES)
  })

  it('fills the nested profiles even with no capability block at all', () => {
    // The regression this guards: the resolver used to return the preset
    // unchanged when a board carried no `capabilities`, leaving `opcua`
    // undefined on a target whose preset enables the server. The pipeline tests
    // `capability && profile` before emitting a config header, so such a target
    // silently got no server.
    const caps = resolveTargetCapabilities({ compiler: 'simulator' })
    expect(caps.opcuaServer).toBe(true)
    expect(caps.opcua).toBeDefined()
    expect(caps.s7).toBeDefined()
  })

  it('defaults to the MOST COMPATIBLE profile, not the most capable', () => {
    // A target that says nothing about itself gets the configuration that
    // works everywhere: no security policy, no certificates, and no assumed
    // crypto hardware. Anything else would be the editor guessing that
    // silicon it has never heard of can do RSA.
    const caps = resolveTargetCapabilities({
      compiler: 'arduino-cli',
      capabilities: { opcuaServer: true, s7Server: true },
    })
    expect(caps.opcua?.security).toBe('none')
    expect(caps.opcua?.certificates).toBe(false)
    expect(caps.opcua?.subscriptions).toBe(false)
    expect(caps.opcua?.hw).toEqual({ sha256: false, aes: false, pk: false, trng: false, rtc: false })
    expect(caps.s7?.pduSize).toBe(240)
    expect(caps.s7?.szl).toBe(true)
  })

  it('flips vppIo on when the board is marked as VPP-derived', () => {
    const caps = resolveTargetCapabilities({ compiler: 'openplc-compiler', vpp: { kind: 'whatever' } })
    expect(caps.vppIo).toBe(true)
    // Other v4 capabilities preserved.
    expect(caps.ethercat).toBe(RUNTIME_V4_CAPABILITIES.ethercat)
    expect(caps.modbusTcpServer).toBe(true)
  })

  it('returns Arduino preset for compiler="arduino-cli"', () => {
    expect(resolveTargetCapabilities({ compiler: 'arduino-cli' })).toEqual(ARDUINO_CLI_CAPABILITIES)
  })

  it('falls back to empty for an unknown compiler string', () => {
    const caps = resolveTargetCapabilities({ compiler: 'mystery-compiler' })
    expect(caps.pinMapping).toBe(false)
    expect(caps.modbusTcpServer).toBe(false)
    expect(caps.debuggerTransports).toEqual([])
  })

  it('lets boardInfo.capabilities override the compiler-derived preset', () => {
    // SLM-RP4-shaped manifest: Runtime v4 baseline + vppIo override.
    const caps = resolveTargetCapabilities({
      compiler: 'openplc-compiler',
      capabilities: { vppIo: true },
    })
    expect(caps.vppIo).toBe(true)
    expect(caps.modbusTcpRemote).toBe(RUNTIME_V4_CAPABILITIES.modbusTcpRemote)
    expect(caps.debuggerTransports).toEqual(RUNTIME_V4_CAPABILITIES.debuggerTransports)
  })

  it('honors a fully-specified capabilities block without inferring from compiler', () => {
    const explicit: TargetCapabilities = {
      ...RUNTIME_V3_CAPABILITIES,
      pinMapping: true, // intentional contradiction with Runtime v3 preset
    }
    const caps = resolveTargetCapabilities({ compiler: 'openplc-compiler', capabilities: explicit })
    // The explicit block wins over the v4-from-compiler default.
    expect(caps.pinMapping).toBe(true)
    expect(caps.vppIo).toBe(false)
    expect(caps.modbusTcpServer).toBe(false)
  })

  it('merges partial capabilities over the preset (no need to declare unchanged fields)', () => {
    const caps = resolveTargetCapabilities({
      compiler: 'arduino-cli',
      capabilities: { modbusTcpServer: true }, // some hypothetical custom Arduino
    })
    expect(caps.modbusTcpServer).toBe(true)
    // Other Arduino defaults preserved.
    expect(caps.pinMapping).toBe(true)
    expect(caps.arduinoApiCompletions).toBe(true)
  })

  it('allows vppIo on an arduino-cli board (Opta-shaped manifest)', () => {
    // The Arduino Opta VPP declares moduleSystem + capabilities.vppIo on
    // an arduino-cli-compiled board.  Both flags must take effect: the
    // capability block enables the backplane configurator UI, and the
    // pinMapping screen is suppressed in favor of the module slots.
    const caps = resolveTargetCapabilities({
      compiler: 'arduino-cli',
      capabilities: { vppIo: true, pinMapping: false },
    })
    expect(caps.vppIo).toBe(true)
    expect(caps.pinMapping).toBe(false)
    // Arduino specifics still flow through where not overridden.
    expect(caps.arduinoApiCompletions).toBe(true)
    expect(caps.directUsbUpload).toBe(true)
    expect(caps.debuggerTransports).toEqual(ARDUINO_CLI_CAPABILITIES.debuggerTransports)
  })

  it('handles a board with capabilities but no compiler (web orchestrator devices)', () => {
    // openplc-web populates capabilities directly on vPLC entries with
    // no `compiler` field. Resolver must take the capabilities verbatim
    // over the empty-block baseline.
    const caps = resolveTargetCapabilities({
      capabilities: { modbusTcpServer: true, modbusTcpRemote: true, debuggerTransports: ['websocket'] },
    })
    expect(caps.modbusTcpServer).toBe(true)
    expect(caps.modbusTcpRemote).toBe(true)
    expect(caps.debuggerTransports).toEqual(['websocket'])
    // Fields not declared remain false.
    expect(caps.pinMapping).toBe(false)
  })
})

describe('preset shapes', () => {
  it('Simulator has the corrected matrix per the design discussion', () => {
    expect(SIMULATOR_CAPABILITIES.pinMapping).toBe(false)
    expect(SIMULATOR_CAPABILITIES.modbusTcpRemote).toBe(true)
    expect(SIMULATOR_CAPABILITIES.ethercat).toBe(true)
    expect(SIMULATOR_CAPABILITIES.modbusTcpServer).toBe(true)
    expect(SIMULATOR_CAPABILITIES.opcuaServer).toBe(true)
    expect(SIMULATOR_CAPABILITIES.s7Server).toBe(true)
    expect(SIMULATOR_CAPABILITIES.debuggerTransports).toEqual(['modbus-serial'])
    expect(SIMULATOR_CAPABILITIES.pythonFunctionBlocks).toBe(true)
    expect(SIMULATOR_CAPABILITIES.isInProcessSimulator).toBe(true)
  })

  it('Runtime v3 has the corrected matrix (no servers, no remote IO, Python yes)', () => {
    expect(RUNTIME_V3_CAPABILITIES.modbusTcpServer).toBe(false)
    expect(RUNTIME_V3_CAPABILITIES.opcuaServer).toBe(false)
    expect(RUNTIME_V3_CAPABILITIES.s7Server).toBe(false)
    expect(RUNTIME_V3_CAPABILITIES.modbusTcpRemote).toBe(false)
    expect(RUNTIME_V3_CAPABILITIES.ethercat).toBe(false)
    expect(RUNTIME_V3_CAPABILITIES.pythonFunctionBlocks).toBe(true)
    expect(RUNTIME_V3_CAPABILITIES.debuggerTransports).toEqual(['modbus-tcp'])
  })

  it('Runtime v4 has vppIo=false (plain) and full server / remote IO support', () => {
    expect(RUNTIME_V4_CAPABILITIES.vppIo).toBe(false)
    expect(RUNTIME_V4_CAPABILITIES.modbusTcpServer).toBe(true)
    expect(RUNTIME_V4_CAPABILITIES.modbusTcpRemote).toBe(true)
    expect(RUNTIME_V4_CAPABILITIES.ethercat).toBe(true)
    expect(RUNTIME_V4_CAPABILITIES.s7Server).toBe(true)
    expect(RUNTIME_V4_CAPABILITIES.debuggerTransports).toEqual(['websocket'])
    expect(RUNTIME_V4_CAPABILITIES.hasRuntimeStats).toBe(true)
  })

  it('Arduino-CLI has pin mapping, Arduino API completions and both Modbus server transports', () => {
    expect(ARDUINO_CLI_CAPABILITIES.pinMapping).toBe(true)
    expect(ARDUINO_CLI_CAPABILITIES.arduinoApiCompletions).toBe(true)
    // The baremetal firmware has always served both — `ModbusSlave.cpp`
    // compiles a serial transport under MBSERIAL and a TCP one under MBTCP.
    // These read `false` until DOPE-442 only because the configuration lived
    // in a vendor screen the Servers UX could not see.
    expect(ARDUINO_CLI_CAPABILITIES.modbusTcpServer).toBe(true)
    expect(ARDUINO_CLI_CAPABILITIES.modbusRtuServer).toBe(true)
    expect(ARDUINO_CLI_CAPABILITIES.pythonFunctionBlocks).toBe(false)
    expect(ARDUINO_CLI_CAPABILITIES.debuggerTransports).toEqual(['modbus-serial', 'modbus-tcp'])
  })

  it('is the only preset that serves Modbus RTU — every runtime slave is TCP-only', () => {
    expect(SIMULATOR_CAPABILITIES.modbusRtuServer).toBe(false)
    expect(RUNTIME_V3_CAPABILITIES.modbusRtuServer).toBe(false)
    expect(RUNTIME_V4_CAPABILITIES.modbusRtuServer).toBe(false)
    expect(ARDUINO_CLI_CAPABILITIES.modbusRtuServer).toBe(true)
  })
})

describe('the S7 profile', () => {
  it('is materialised only for a target that can host an S7 server', () => {
    // A profile on a target that cannot host one is noise, and leaving it
    // undefined keeps EMPTY_CAPABILITIES genuinely empty.
    const without = resolveTargetCapabilities({ compiler: 'arduino-cli', capabilities: { s7Server: false } })
    expect(without.s7).toBeUndefined()

    const with7 = resolveTargetCapabilities({ compiler: 'arduino-cli', capabilities: { s7Server: true } })
    expect(with7.s7).toBeDefined()
  })

  it('fills everything a manifest did not declare', () => {
    // A VPP declares only what it raises. A shallow spread would leave the
    // rest undefined and the generated header would be missing defines.
    const caps = resolveTargetCapabilities({
      compiler: 'arduino-cli',
      capabilities: { s7Server: true, s7: { maxClients: 4 } },
    })
    expect(caps.s7?.maxClients).toBe(4)
    expect(caps.s7?.pduSize).toBe(240)
    expect(caps.s7?.maxDataBlocks).toBe(8)
    expect(caps.s7?.writeEnabled).toBe(true)
    expect(caps.s7?.szl).toBe(true)
  })

  it('defaults below Runtime v4, deliberately', () => {
    // v4 allows 32 clients and 64 DBs because it is a Linux process with a
    // thread each. Here every client is a PDU pair in .bss.
    const caps = resolveTargetCapabilities({ compiler: 'arduino-cli', capabilities: { s7Server: true } })
    expect(caps.s7?.maxClients).toBe(2)
    expect(caps.s7?.maxDataBlocks).toBe(8)
  })

  it('leaves the OPC-UA profile alone', () => {
    // The two are independent blocks; resolving one must not disturb the other.
    const caps = resolveTargetCapabilities({
      compiler: 'arduino-cli',
      capabilities: { s7Server: true, opcuaServer: true, opcua: { maxSessions: 2 } },
    })
    expect(caps.opcua?.maxSessions).toBe(2)
    expect(caps.s7?.maxClients).toBe(2)
  })
})

describe('the RTOS profile', () => {
  it('comes from the board core, whichever package the board belongs to', () => {
    // Every ESP32 variant runs FreeRTOS; support is the core's, not a board's.
    const caps = resolveTargetCapabilities({ compiler: 'arduino-cli', core: 'esp32:esp32' })
    expect(caps.rtos).toEqual({
      backend: 'freertos-esp32',
      tickNs: 1_000_000,
      workLevels: 8,
      maxTasks: 8,
      threads: 'native',
    })
  })

  it('reads the core off the FQBN when that is all the caller has', () => {
    const caps = resolveTargetCapabilities({
      compiler: 'arduino-cli',
      platform: 'esp32:esp32:esp32s3:CDCOnBoot=cdc,USBMode=hwcdc',
    })
    expect(caps.rtos?.backend).toBe('freertos-esp32')
  })

  it('is absent on a core with no backend', () => {
    expect(resolveTargetCapabilities({ compiler: 'arduino-cli', core: 'arduino:avr' }).rtos).toBeUndefined()
  })

  it('is never offered to the in-process simulator or a Runtime target', () => {
    // The simulator is an AVR build that runs user logic only; a Runtime target
    // already threads its tasks.
    expect(resolveTargetCapabilities({ compiler: 'simulator', core: 'esp32:esp32' }).rtos).toBeUndefined()
    expect(resolveTargetCapabilities({ compiler: 'openplc-compiler', core: 'esp32:esp32' }).rtos).toBeUndefined()
  })

  it('lets a package refuse it for its board', () => {
    const caps = resolveTargetCapabilities({
      compiler: 'arduino-cli',
      core: 'esp32:esp32',
      capabilities: { rtos: false },
    })
    expect(caps.rtos).toBeUndefined()
  })

  it('takes an empty core for no core', () => {
    expect(resolveTargetCapabilities({ compiler: 'arduino-cli', core: '' }).rtos).toBeUndefined()
  })

  it('follows the core a board compiles with, its FQBN’s, over the manifest’s core', () => {
    const fromFqbn = { compiler: 'arduino-cli', core: 'arduino:avr', platform: 'esp32:esp32:nano_nora' }
    expect(resolveTargetCapabilities(fromFqbn).rtos?.backend).toBe('freertos-esp32')
    const noRtos = { compiler: 'arduino-cli', core: 'esp32:esp32', platform: 'arduino:avr:mega' }
    expect(resolveTargetCapabilities(noRtos).rtos).toBeUndefined()
  })

  it('sizes an STM32 by its board id or its part', () => {
    const bluepill = { compiler: 'arduino-cli', platform: 'STMicroelectronics:stm32:GenF1:pnum=BLUEPILL_F103C8' }
    expect(resolveTargetCapabilities(bluepill).rtos).toBeUndefined()
    const f0 = { compiler: 'arduino-cli', platform: 'STMicroelectronics:stm32:GenF0:pnum=GENERIC_F030F4PX' }
    expect(resolveTargetCapabilities(f0).rtos).toBeUndefined()
    const nucleoF103 = { compiler: 'arduino-cli', platform: 'STMicroelectronics:stm32:Nucleo_64:pnum=NUCLEO_F103RB' }
    expect(resolveTargetCapabilities(nucleoF103).rtos).toBeUndefined()
    const blackpill = { compiler: 'arduino-cli', platform: 'STMicroelectronics:stm32:GenF4:pnum=BLACKPILL_F411CE' }
    expect(resolveTargetCapabilities(blackpill).rtos?.backend).toBe('freertos-stm32')
  })
})
