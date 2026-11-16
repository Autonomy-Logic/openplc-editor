import type { BoardInfo } from '../../../ports/types'
import {
  ALL_ADDRESS_PRODUCERS_ACTIVE,
  ARDUINO_CLI_CAPABILITIES,
  RUNTIME_V3_CAPABILITIES,
  RUNTIME_V4_CAPABILITIES,
  SIMULATOR_CAPABILITIES,
} from '../presets'
import { resolveAddressProducerCapabilities, resolveTargetCapabilities } from '../resolve'
import type { TargetCapabilities } from '../types'

describe('resolveTargetCapabilities', () => {
  it('returns an empty (everything-disabled) block when no board info is provided', () => {
    const caps = resolveTargetCapabilities(undefined)
    expect(caps.pinMapping).toBe(false)
    expect(caps.vppIo).toBe(false)
    expect(caps.modbusTcpMaster).toBe(false)
    expect(caps.modbusRtuMaster).toBe(false)
    expect(caps.debuggerTransports).toEqual([])
  })

  it('returns Simulator preset for compiler="simulator"', () => {
    expect(resolveTargetCapabilities({ compiler: 'simulator' })).toMatchObject(SIMULATOR_CAPABILITIES)
  })

  it('returns Runtime v4 preset for compiler="openplc-compiler" (non-VPP)', () => {
    expect(resolveTargetCapabilities({ compiler: 'openplc-compiler' })).toMatchObject(RUNTIME_V4_CAPABILITIES)
  })

  it('fills the nested profiles even with no capability block at all', () => {
    const caps = resolveTargetCapabilities({ compiler: 'simulator' })
    expect(caps.opcuaServer).toBe(true)
    expect(caps.opcua).toBeDefined()
    expect(caps.s7).toBeDefined()
  })

  it('defaults to the MOST COMPATIBLE profile, not the most capable', () => {
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
    const caps = resolveTargetCapabilities({
      compiler: 'openplc-compiler',
      capabilities: { vppIo: true },
    })
    expect(caps.vppIo).toBe(true)
    expect(caps.modbusTcpMaster).toBe(RUNTIME_V4_CAPABILITIES.modbusTcpMaster)
    expect(caps.modbusRtuMaster).toBe(RUNTIME_V4_CAPABILITIES.modbusRtuMaster)
    expect(caps.debuggerTransports).toEqual(RUNTIME_V4_CAPABILITIES.debuggerTransports)
  })

  it('honors a fully-specified capabilities block without inferring from compiler', () => {
    const explicit: TargetCapabilities = {
      ...RUNTIME_V3_CAPABILITIES,
      pinMapping: true,
    }
    const caps = resolveTargetCapabilities({ compiler: 'openplc-compiler', capabilities: explicit })
    expect(caps.pinMapping).toBe(true)
    expect(caps.vppIo).toBe(false)
    expect(caps.modbusTcpServer).toBe(false)
  })

  it('merges partial capabilities over the preset (no need to declare unchanged fields)', () => {
    const caps = resolveTargetCapabilities({
      compiler: 'arduino-cli',
      capabilities: { modbusTcpServer: true },
    })
    expect(caps.modbusTcpServer).toBe(true)
    expect(caps.pinMapping).toBe(true)
    expect(caps.arduinoApiCompletions).toBe(true)
  })

  it('allows vppIo on an arduino-cli board (Opta-shaped manifest)', () => {
    const caps = resolveTargetCapabilities({
      compiler: 'arduino-cli',
      capabilities: { vppIo: true, pinMapping: false },
    })
    expect(caps.vppIo).toBe(true)
    expect(caps.pinMapping).toBe(false)
    expect(caps.arduinoApiCompletions).toBe(true)
    expect(caps.directUsbUpload).toBe(true)
    expect(caps.debuggerTransports).toEqual(ARDUINO_CLI_CAPABILITIES.debuggerTransports)
  })

  it('handles a board with capabilities but no compiler (web orchestrator devices)', () => {
    const caps = resolveTargetCapabilities({
      capabilities: { modbusTcpServer: true, modbusTcpMaster: true, debuggerTransports: ['websocket'] },
    })
    expect(caps.modbusTcpServer).toBe(true)
    expect(caps.modbusTcpMaster).toBe(true)
    expect(caps.debuggerTransports).toEqual(['websocket'])
    expect(caps.pinMapping).toBe(false)
    expect(caps.modbusRtuMaster).toBe(false)
  })
})

describe('preset shapes', () => {
  it('Simulator has the corrected matrix per the design discussion', () => {
    expect(SIMULATOR_CAPABILITIES.pinMapping).toBe(false)
    expect(SIMULATOR_CAPABILITIES.modbusTcpMaster).toBe(true)
    expect(SIMULATOR_CAPABILITIES.modbusRtuMaster).toBe(true)
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
    expect(RUNTIME_V3_CAPABILITIES.modbusTcpMaster).toBe(false)
    expect(RUNTIME_V3_CAPABILITIES.modbusRtuMaster).toBe(false)
    expect(RUNTIME_V3_CAPABILITIES.ethercat).toBe(false)
    expect(RUNTIME_V3_CAPABILITIES.pythonFunctionBlocks).toBe(true)
    expect(RUNTIME_V3_CAPABILITIES.debuggerTransports).toEqual(['modbus-tcp'])
  })

  it('Runtime v4 has vppIo=false (plain) and full server / remote IO support', () => {
    expect(RUNTIME_V4_CAPABILITIES.vppIo).toBe(false)
    expect(RUNTIME_V4_CAPABILITIES.modbusTcpServer).toBe(true)
    expect(RUNTIME_V4_CAPABILITIES.modbusTcpMaster).toBe(true)
    expect(RUNTIME_V4_CAPABILITIES.modbusRtuMaster).toBe(true)
    expect(RUNTIME_V4_CAPABILITIES.ethercat).toBe(true)
    expect(RUNTIME_V4_CAPABILITIES.s7Server).toBe(true)
    expect(RUNTIME_V4_CAPABILITIES.debuggerTransports).toEqual(['websocket'])
    expect(RUNTIME_V4_CAPABILITIES.hasRuntimeStats).toBe(true)
  })

  it('Arduino-CLI has pin mapping, Arduino API completions and both Modbus server transports', () => {
    expect(ARDUINO_CLI_CAPABILITIES.pinMapping).toBe(true)
    expect(ARDUINO_CLI_CAPABILITIES.arduinoApiCompletions).toBe(true)
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

describe('resolveAddressProducerCapabilities', () => {
  it('is permissive when there is no board info at all', () => {
    expect(resolveAddressProducerCapabilities(undefined)).toEqual(ALL_ADDRESS_PRODUCERS_ACTIVE)
  })

  it('is permissive for an entry with neither a capability block nor a known compiler', () => {
    expect(resolveAddressProducerCapabilities({})).toEqual(ALL_ADDRESS_PRODUCERS_ACTIVE)
    expect(resolveAddressProducerCapabilities({ compiler: 'something-else' })).toEqual(ALL_ADDRESS_PRODUCERS_ACTIVE)
  })

  it('is permissive for a capability block that names no producer', () => {
    expect(resolveAddressProducerCapabilities({ capabilities: { opcuaServer: true } })).toEqual(
      ALL_ADDRESS_PRODUCERS_ACTIVE,
    )
  })

  it('lets the compiler answer when the block names no producer', () => {
    const caps = resolveAddressProducerCapabilities({ compiler: 'simulator', capabilities: { opcuaServer: true } })
    expect(caps.pinMapping).toBe(false)
    expect(caps.modbusTcpMaster).toBe(true)
  })

  it('treats a producer declared false as an answer, not as silence', () => {
    const caps = resolveAddressProducerCapabilities({ capabilities: { pinMapping: false } })
    expect(caps.pinMapping).toBe(false)
  })

  it('honours a target that answered, including when it answers all-false', () => {
    const simulator = resolveAddressProducerCapabilities({ compiler: 'simulator' })
    expect(simulator.pinMapping).toBe(false)
    expect(simulator.modbusTcpMaster).toBe(true)

    const arduino = resolveAddressProducerCapabilities({ compiler: 'arduino-cli' })
    expect(arduino.pinMapping).toBe(true)
    expect(arduino.modbusTcpMaster).toBe(false)
    expect(arduino.modbusRtuMaster).toBe(true)
  })

  it('honours an explicit capability block even with no compiler', () => {
    const caps = resolveAddressProducerCapabilities({ capabilities: { pinMapping: true } })
    expect(caps.pinMapping).toBe(true)
    expect(caps.ethercat).toBe(false)
  })
})

describe('the S7 profile', () => {
  it('is materialised only for a target that can host an S7 server', () => {
    const without = resolveTargetCapabilities({ compiler: 'arduino-cli', capabilities: { s7Server: false } })
    expect(without.s7).toBeUndefined()

    const with7 = resolveTargetCapabilities({ compiler: 'arduino-cli', capabilities: { s7Server: true } })
    expect(with7.s7).toBeDefined()
  })

  it('fills everything a manifest did not declare', () => {
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
    const caps = resolveTargetCapabilities({ compiler: 'arduino-cli', capabilities: { s7Server: true } })
    expect(caps.s7?.maxClients).toBe(2)
    expect(caps.s7?.maxDataBlocks).toBe(8)
  })

  it('leaves the OPC-UA profile alone', () => {
    const caps = resolveTargetCapabilities({
      compiler: 'arduino-cli',
      capabilities: { s7Server: true, opcuaServer: true, opcua: { maxSessions: 2 } },
    })
    expect(caps.opcua?.maxSessions).toBe(2)
    expect(caps.s7?.maxClients).toBe(2)
  })
})

describe('the Modbus master capabilities', () => {
  it('gives Runtime v4 both the TCP and the RTU master', () => {
    const caps = resolveTargetCapabilities({ compiler: 'openplc-compiler' })
    expect(caps.modbusTcpMaster).toBe(true)
    expect(caps.modbusRtuMaster).toBe(true)
  })

  it('gives the Simulator both masters, for the screen only', () => {
    const caps = resolveTargetCapabilities({ compiler: 'simulator' })
    expect(caps.modbusTcpMaster).toBe(true)
    expect(caps.modbusRtuMaster).toBe(true)
  })

  it('gives the Arduino family the RTU master and leaves TCP to the manifest', () => {
    const caps = resolveTargetCapabilities({ compiler: 'arduino-cli' })
    expect(caps.modbusTcpMaster).toBe(false)
    expect(caps.modbusRtuMaster).toBe(true)
  })

  it('raises the TCP master on a baremetal board whose manifest declares it', () => {
    const caps = resolveTargetCapabilities({ compiler: 'arduino-cli', capabilities: { modbusTcpMaster: true } })
    expect(caps.modbusTcpMaster).toBe(true)
    expect(caps.modbusRtuMaster).toBe(true)
  })

  it('takes the network socket count a manifest declares', () => {
    const caps = resolveTargetCapabilities({
      compiler: 'arduino-cli',
      capabilities: { modbusTcpMaster: true, networkSockets: 4 },
    })
    expect(caps.networkSockets).toBe(4)
  })

  it('reports no socket count where nothing declares one', () => {
    expect(resolveTargetCapabilities({ compiler: 'arduino-cli' }).networkSockets).toBeNull()
    expect(resolveTargetCapabilities({ compiler: 'openplc-compiler' }).networkSockets).toBeNull()
    expect(resolveTargetCapabilities(undefined).networkSockets).toBeNull()
  })

  it('activates both masters as address producers when the board is unresolved', () => {
    expect(ALL_ADDRESS_PRODUCERS_ACTIVE.modbusTcpMaster).toBe(true)
    expect(ALL_ADDRESS_PRODUCERS_ACTIVE.modbusRtuMaster).toBe(true)
  })
})

describe('modbusRtuMaster declared by a board', () => {
  const vppPackage: BoardInfo['vpp'] = {
    packageId: 'com.openplc.arduino',
    vendor: 'OpenPLC',
    deviceId: 'mega',
    packagePath: '/packages/com.openplc.arduino',
    screens: {},
    moduleSystem: null,
  }

  it('is ignored on a VPP baremetal board, so the family preset stands', () => {
    const board: BoardInfo = {
      compiler: 'arduino-cli',
      core: 'arduino:avr',
      preview: '',
      specs: {},
      capabilities: { modbusTcpMaster: true, modbusRtuMaster: false },
      vpp: vppPackage,
    }
    expect(resolveTargetCapabilities(board).modbusRtuMaster).toBe(true)
  })

  it('is ignored on a board that resolveBoardSelection marks as VPP', () => {
    const capabilities = declaring({ modbusTcpMaster: true, modbusRtuMaster: false })
    expect(resolveTargetCapabilities({ compiler: 'arduino-cli', vpp: true, capabilities }).modbusRtuMaster).toBe(true)
  })

  it('is ignored on a VPP Runtime v4 board', () => {
    const capabilities = declaring({ modbusTcpMaster: true, modbusRtuMaster: false })
    expect(resolveTargetCapabilities({ compiler: 'openplc-compiler', vpp: true, capabilities }).modbusRtuMaster).toBe(
      true,
    )
  })

  it('keeps the RTU master off on the built-in Runtime v3 entry, which is not a VPP board', () => {
    expect(
      resolveTargetCapabilities({
        compiler: 'openplc-compiler',
        capabilities: declaring({ modbusTcpMaster: false, modbusRtuMaster: false }),
      }).modbusRtuMaster,
    ).toBe(false)
  })

  it('keeps the RTU master on for the built-in Simulator entry', () => {
    expect(
      resolveTargetCapabilities({
        compiler: 'simulator',
        capabilities: declaring({ modbusTcpMaster: true, modbusRtuMaster: true }),
      }).modbusRtuMaster,
    ).toBe(true)
  })
})

/** A capability block naming both Modbus masters, as a manifest or a hals.json entry writes it. */
function declaring(
  masters: Pick<TargetCapabilities, 'modbusTcpMaster' | 'modbusRtuMaster'>,
): Partial<TargetCapabilities> {
  return { ...masters }
}
