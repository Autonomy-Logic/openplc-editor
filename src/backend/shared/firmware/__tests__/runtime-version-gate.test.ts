import { isVersionAtLeast } from '../../../../frontend/utils/semver'
import {
  describeEditorTooOldForRuntime,
  describeIncompatibleRuntime,
  describeVppRuntimeMismatch,
  isStrucppCompatibleRuntime,
  isRetainConfigCapableRuntime,
  isUserManagementCapableRuntime,
  MIN_RUNTIME_VERSION,
  MIN_STRUCPP_RUNTIME_VERSION,
  MIN_RETAIN_CONFIG_RUNTIME_VERSION,
  MIN_USER_MANAGEMENT_RUNTIME_VERSION,
  parseRuntimeVersion,
} from '../runtime-version-gate'

describe('isRetainConfigCapableRuntime', () => {
  it('is exposed with the documented minimum version', () => {
    expect(MIN_RETAIN_CONFIG_RUNTIME_VERSION).toBe('4.2.0')
  })

  it('accepts v4.2.0 and newer', () => {
    expect(isRetainConfigCapableRuntime('v4.2.0')).toBe(true)
    expect(isRetainConfigCapableRuntime('4.2.1')).toBe(true)
    expect(isRetainConfigCapableRuntime('v5.0.0')).toBe(true)
  })

  it('accepts a pre-release on the target patch', () => {
    expect(isRetainConfigCapableRuntime('v4.2.0-rc.1')).toBe(true)
  })

  it('rejects runtimes with no built-in retain store', () => {
    // 4.1.10 can still do retain through a VPP driver; what it lacks is
    // anything for this screen to configure.
    expect(isRetainConfigCapableRuntime('v4.1.10')).toBe(false)
    expect(isRetainConfigCapableRuntime('v4.1.9')).toBe(false)
    expect(isRetainConfigCapableRuntime('v3.0.0')).toBe(false)
  })

  it('rejects an unknown version rather than guessing', () => {
    expect(isRetainConfigCapableRuntime(null)).toBe(false)
    expect(isRetainConfigCapableRuntime(undefined)).toBe(false)
    expect(isRetainConfigCapableRuntime('')).toBe(false)
    expect(isRetainConfigCapableRuntime('dev')).toBe(false)
  })
})

describe('isUserManagementCapableRuntime', () => {
  it('is exposed with the documented minimum version', () => {
    expect(MIN_USER_MANAGEMENT_RUNTIME_VERSION).toBe('4.1.9')
  })

  it('accepts v4.1.9 and newer', () => {
    expect(isUserManagementCapableRuntime('v4.1.9')).toBe(true)
    expect(isUserManagementCapableRuntime('4.1.10')).toBe(true)
    expect(isUserManagementCapableRuntime('v4.2.0')).toBe(true)
    expect(isUserManagementCapableRuntime('v5.0.0')).toBe(true)
  })

  it('accepts a pre-release on the target patch', () => {
    expect(isUserManagementCapableRuntime('v4.1.9-rc.1')).toBe(true)
  })

  it('rejects versions older than 4.1.9', () => {
    expect(isUserManagementCapableRuntime('v4.1.8')).toBe(false)
    expect(isUserManagementCapableRuntime('v4.0.9')).toBe(false)
    expect(isUserManagementCapableRuntime('v3.9.9')).toBe(false)
  })

  it('rejects unparseable / legacy version strings', () => {
    expect(isUserManagementCapableRuntime('v4')).toBe(false)
    expect(isUserManagementCapableRuntime('dev')).toBe(false)
    expect(isUserManagementCapableRuntime(null)).toBe(false)
    expect(isUserManagementCapableRuntime(undefined)).toBe(false)
  })
})

describe('parseRuntimeVersion', () => {
  it('parses tagged release versions (with and without leading v)', () => {
    expect(parseRuntimeVersion('v4.1.0')).toEqual({ major: 4, minor: 1, patch: 0 })
    expect(parseRuntimeVersion('4.1.0')).toEqual({ major: 4, minor: 1, patch: 0 })
    expect(parseRuntimeVersion('v5.0.12')).toEqual({ major: 5, minor: 0, patch: 12 })
  })

  it('parses pre-release tags', () => {
    expect(parseRuntimeVersion('v4.1.0-rc.3')).toEqual({
      major: 4,
      minor: 1,
      patch: 0,
      prerelease: 'rc.3',
    })
    expect(parseRuntimeVersion('v4.1.0-beta.1')).toEqual({
      major: 4,
      minor: 1,
      patch: 0,
      prerelease: 'beta.1',
    })
  })

  // A missing component is zero everywhere in this codebase, so the legacy
  // header parses rather than being rejected as junk. The gate's answer is
  // unchanged — see `isStrucppCompatibleRuntime` below — because 4.0.0 is
  // genuinely below the 4.1.0 floor. The distinction matters: "I cannot read
  // this" and "this is old" are different facts and only one of them is true.
  it('reads the legacy hardcoded "v4" string as 4.0.0', () => {
    expect(parseRuntimeVersion('v4')).toEqual({ major: 4, minor: 0, patch: 0, prerelease: undefined })
  })

  it('fills a missing patch component with zero', () => {
    expect(parseRuntimeVersion('v4.1')).toEqual({ major: 4, minor: 1, patch: 0, prerelease: undefined })
    expect(parseRuntimeVersion('v4.1')).toEqual(parseRuntimeVersion('4.1.0'))
  })

  it('rejects ambiguous / non-numeric strings', () => {
    expect(parseRuntimeVersion('dev')).toBeNull()
    expect(parseRuntimeVersion('v4.x.0')).toBeNull()
    expect(parseRuntimeVersion('  ')).toBeNull()
  })

  it('returns null for missing / empty input', () => {
    expect(parseRuntimeVersion(null)).toBeNull()
    expect(parseRuntimeVersion(undefined)).toBeNull()
    expect(parseRuntimeVersion('')).toBeNull()
  })
})

describe('isStrucppCompatibleRuntime', () => {
  it('accepts v4.1.0 and newer', () => {
    expect(isStrucppCompatibleRuntime('v4.1.0')).toBe(true)
    expect(isStrucppCompatibleRuntime('v4.1.5')).toBe(true)
    expect(isStrucppCompatibleRuntime('v4.2.0')).toBe(true)
    expect(isStrucppCompatibleRuntime('v5.0.0')).toBe(true)
  })

  it('accepts pre-release tags on the v4.1.x line (rc lineage IS the strucpp line)', () => {
    expect(isStrucppCompatibleRuntime('v4.1.0-rc.1')).toBe(true)
    expect(isStrucppCompatibleRuntime('v4.1.0-rc.3')).toBe(true)
    expect(isStrucppCompatibleRuntime('v4.1.0-beta.2')).toBe(true)
  })

  it('rejects v4.0.x (MatIEC line)', () => {
    expect(isStrucppCompatibleRuntime('v4.0.9')).toBe(false)
    expect(isStrucppCompatibleRuntime('v4.0.0')).toBe(false)
  })

  it('rejects anything below major 4', () => {
    expect(isStrucppCompatibleRuntime('v3.5.0')).toBe(false)
    expect(isStrucppCompatibleRuntime('v0.0.1')).toBe(false)
  })

  it('rejects the legacy "v4" header + any other unparseable string', () => {
    // `v4` now parses (as 4.0.0) and is refused on its merits; the rest are
    // unreadable and are refused because an unknown runtime never clears a
    // floor. Both paths must stay closed.
    expect(isStrucppCompatibleRuntime('v4')).toBe(false)
    expect(isStrucppCompatibleRuntime('dev')).toBe(false)
    expect(isStrucppCompatibleRuntime(null)).toBe(false)
    expect(isStrucppCompatibleRuntime(undefined)).toBe(false)
    expect(isStrucppCompatibleRuntime('')).toBe(false)
  })

  it('accepts a two-part version at or above the floor', () => {
    expect(isStrucppCompatibleRuntime('v4.1')).toBe(true)
    expect(isStrucppCompatibleRuntime('4.2')).toBe(true)
    expect(isStrucppCompatibleRuntime('4.0')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Every capability gate is "a constant + isVersionAtLeast", nothing more
// ---------------------------------------------------------------------------
//
// These read as tautologies today, and that is the point: they fail the moment
// someone re-inlines a comparison next to a constant. The version this replaced
// answered `v.minor >= 1` for the strucpp gate — correct only because the floor
// happened to end in `.0`. Raise the floor to `4.1.5` and that body keeps
// admitting 4.1.0 while every behavioural test still passes, because the tests
// were written against the old floor too. Deriving the expectation from the
// constant is the only assertion that survives a bump.
describe('capability gates track their constants', () => {
  const CANDIDATES = [
    null,
    undefined,
    '',
    'dev',
    'garbage',
    'v4',
    '4.0',
    '4.1',
    '3.9.9',
    '4.0.9',
    '4.1.0',
    '4.1.0-rc.3',
    '4.1.8',
    '4.1.9',
    '4.1.9-rc.1',
    '4.1.10',
    '4.2.0',
    '4.10.0',
    '5.0.0',
  ]

  it.each(CANDIDATES)('isStrucppCompatibleRuntime(%p) === isVersionAtLeast(%p, MIN_RUNTIME_VERSION)', (raw) => {
    expect(isStrucppCompatibleRuntime(raw)).toBe(isVersionAtLeast(raw, MIN_RUNTIME_VERSION))
  })

  it.each(CANDIDATES)('isUserManagementCapableRuntime(%p) tracks its own constant', (raw) => {
    expect(isUserManagementCapableRuntime(raw)).toBe(isVersionAtLeast(raw, MIN_USER_MANAGEMENT_RUNTIME_VERSION))
  })

  it('puts each gate exactly on its own floor', () => {
    expect(isStrucppCompatibleRuntime(MIN_RUNTIME_VERSION)).toBe(true)
    expect(isUserManagementCapableRuntime(MIN_USER_MANAGEMENT_RUNTIME_VERSION)).toBe(true)
    // The floors are ordered, so the lower gate must be open where the higher
    // one is shut — a single `minor >= 1` body cannot express that difference.
    expect(isStrucppCompatibleRuntime('4.1.0')).toBe(true)
    expect(isUserManagementCapableRuntime('4.1.0')).toBe(false)
  })
})

describe('describeIncompatibleRuntime', () => {
  it('mentions the reported version and the minimum required', () => {
    const msg = describeIncompatibleRuntime('v4.0.9')
    expect(msg).toContain('v4.0.9')
    expect(msg).toContain(MIN_STRUCPP_RUNTIME_VERSION)
    expect(msg).toContain('STruC++')
  })

  it('says "unknown" when no version was reported', () => {
    expect(describeIncompatibleRuntime(null)).toContain('unknown')
    expect(describeIncompatibleRuntime('')).toContain('unknown')
    expect(describeIncompatibleRuntime('   ')).toContain('unknown')
  })
})

describe('describeEditorTooOldForRuntime', () => {
  const args = { runtimeVersion: 'v4.3.0', minEditorVersion: '4.3.0', editorVersion: '4.2.10' }

  it('names both versions and the action that fixes it', () => {
    const msg = describeEditorTooOldForRuntime(args)
    expect(msg).toContain('v4.3.0')
    expect(msg).toContain('4.3.0')
    expect(msg).toContain('4.2.10')
    expect(msg).toContain('Update the editor')
  })

  it('includes the device address when the platform knows one', () => {
    expect(describeEditorTooOldForRuntime({ ...args, deviceLabel: '10.0.0.1' })).toContain('on 10.0.0.1')
  })

  it('omits the device clause when no label is available', () => {
    // Web reaches the device through an orchestrator agent, so there is no
    // address the user would recognise — better to say nothing than to print
    // an agent id nobody can act on.
    expect(describeEditorTooOldForRuntime(args)).not.toContain(' on ')
  })

  // The message must never contain a hole where a version should be. A blank
  // runtime version is not "no version" — it is a version we failed to
  // establish, and the user needs to be told which of the two we could not read.
  const UNREADABLE: Array<[string | null | undefined, string]> = [
    ['', 'an empty string'],
    ['   ', 'whitespace only'],
    [null, 'null'],
    [undefined, 'undefined'],
  ]

  it.each(UNREADABLE)('renders a %p runtime version as "unknown" (%s)', (runtimeVersion) => {
    const msg = describeEditorTooOldForRuntime({ ...args, runtimeVersion })
    expect(msg).toContain('Runtime unknown requires')
  })
})

describe('describeVppRuntimeMismatch', () => {
  const args = { boardTarget: 'SLM-RP4', minRuntimeVersion: '4.2.0', runtimeVersion: 'v4.1.7' }

  it('names the board, the floor, and the reported runtime', () => {
    const msg = describeVppRuntimeMismatch(args)
    expect(msg).toContain('"SLM-RP4"')
    expect(msg).toContain('v4.2.0')
    expect(msg).toContain('v4.1.7')
    expect(msg).toContain('Upgrade the runtime')
  })

  it('names the device when the platform knows its address', () => {
    expect(describeVppRuntimeMismatch({ ...args, deviceLabel: '10.0.0.1' })).toContain(
      'The runtime at 10.0.0.1 reports',
    )
  })

  it('falls back to "the connected runtime" without a label', () => {
    expect(describeVppRuntimeMismatch(args)).toContain('The connected runtime reports')
  })

  const UNREADABLE: Array<[string | null | undefined, string]> = [
    ['', 'an empty string'],
    ['   ', 'whitespace only'],
    [null, 'null'],
    [undefined, 'undefined'],
  ]

  it.each(UNREADABLE)('renders a %p runtime version as "unknown" (%s)', (runtimeVersion) => {
    const msg = describeVppRuntimeMismatch({ ...args, runtimeVersion })
    expect(msg).toContain('reports unknown.')
    expect(msg).not.toContain('reports .')
  })
})
