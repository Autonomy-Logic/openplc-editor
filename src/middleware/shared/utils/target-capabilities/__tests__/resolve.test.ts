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

  it('returns Simulator preset for compiler="simulator"', () => {
    expect(resolveTargetCapabilities({ compiler: 'simulator' })).toEqual(SIMULATOR_CAPABILITIES)
  })

  it('returns Runtime v4 preset for compiler="openplc-compiler" (non-VPP)', () => {
    expect(resolveTargetCapabilities({ compiler: 'openplc-compiler' })).toEqual(RUNTIME_V4_CAPABILITIES)
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

  it('Arduino-CLI has only pin mapping and Arduino API completions', () => {
    expect(ARDUINO_CLI_CAPABILITIES.pinMapping).toBe(true)
    expect(ARDUINO_CLI_CAPABILITIES.arduinoApiCompletions).toBe(true)
    expect(ARDUINO_CLI_CAPABILITIES.modbusTcpServer).toBe(false)
    expect(ARDUINO_CLI_CAPABILITIES.pythonFunctionBlocks).toBe(false)
    expect(ARDUINO_CLI_CAPABILITIES.debuggerTransports).toEqual(['modbus-serial', 'modbus-tcp'])
  })
})
