import type { TargetCapabilities } from '../../../../middleware/shared/utils/target-capabilities/types'
import {
  OPEN62541_LIBRARY,
  selectThirdPartyLibraries,
  SETTIMINO_LIBRARY,
  THIRD_PARTY_LIBRARIES,
} from '../third-party-libraries'

const caps = (over: Partial<TargetCapabilities> = {}): TargetCapabilities =>
  ({
    pinMapping: false,
    vppIo: false,
    modbusTcpRemote: false,
    ethercat: false,
    modbusTcpServer: false,
    opcuaServer: false,
    s7Server: false,
    debuggerTransports: [],
    pythonFunctionBlocks: false,
    arduinoApiCompletions: false,
    hasRuntimeStats: false,
    isInProcessSimulator: false,
    nativeRetainStore: false,
    plcStateControl: false,
    directUsbUpload: false,
    isLicensable: false,
    ...over,
  }) as TargetCapabilities

describe('selectThirdPartyLibraries', () => {
  it('gives an OPC-UA target the stack', () => {
    expect(selectThirdPartyLibraries(caps({ opcuaServer: true }))).toEqual([OPEN62541_LIBRARY])
  })

  it('gives a target that cannot host a server nothing', () => {
    // A board with no OPC-UA support must not download 7 MB of OPC-UA stack.
    expect(selectThirdPartyLibraries(caps())).toEqual([])
  })

  it('returns nothing when capabilities are unknown', () => {
    expect(selectThirdPartyLibraries(undefined)).toEqual([])
  })

  it('selects by capability, never by board name', () => {
    // The selector takes capabilities only — there is no board identity to
    // switch on, which is what keeps adding a target a manifest change.
    expect(selectThirdPartyLibraries.length).toBe(1)
  })
})

describe('the catalogue', () => {
  it('names libraries as library.properties does, so the install cache matches', () => {
    // A mismatch here makes the library look perpetually missing and it gets
    // reinstalled on every build — the exact Windows symptom this work fixed.
    expect(OPEN62541_LIBRARY.name).toBe('open62541')
  })

  it('pins no ref: the default branch is production', () => {
    expect(OPEN62541_LIBRARY.gitUrl).not.toContain('#')
  })

  it('explains itself in the compile log', () => {
    for (const lib of THIRD_PARTY_LIBRARIES) {
      expect(lib.reason.length).toBeGreaterThan(0)
      expect(lib.gitUrl).toMatch(/^https:\/\//)
    }
  })
})

describe('S7 selection', () => {
  it('gives an S7 target the Settimino fork', () => {
    expect(selectThirdPartyLibraries(caps({ s7Server: true }))).toEqual([SETTIMINO_LIBRARY])
  })

  it('gives a target running both protocols both libraries', () => {
    // They are independent: a board may host one, the other, or both, and the
    // LOGO! measurably hosts both (+1,544 B flash, +2,504 B RAM for S7 on top
    // of OPC-UA).
    expect(selectThirdPartyLibraries(caps({ opcuaServer: true, s7Server: true }))).toEqual([
      OPEN62541_LIBRARY,
      SETTIMINO_LIBRARY,
    ])
  })

  it('does not hand the S7 library to an OPC-UA-only target', () => {
    expect(selectThirdPartyLibraries(caps({ opcuaServer: true }))).toEqual([OPEN62541_LIBRARY])
  })

  it('names Settimino as its library.properties does', () => {
    expect(SETTIMINO_LIBRARY.name).toBe('Settimino')
  })
})
