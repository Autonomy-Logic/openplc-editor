import {
  describeIncompatibleRuntime,
  isStrucppCompatibleRuntime,
  MIN_STRUCPP_RUNTIME_VERSION,
  parseRuntimeVersion,
} from '../runtime-version-gate'

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

  it('rejects the legacy hardcoded "v4" string', () => {
    expect(parseRuntimeVersion('v4')).toBeNull()
  })

  it('rejects ambiguous / non-numeric strings', () => {
    expect(parseRuntimeVersion('dev')).toBeNull()
    expect(parseRuntimeVersion('v4.1')).toBeNull()
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
    expect(isStrucppCompatibleRuntime('v4')).toBe(false)
    expect(isStrucppCompatibleRuntime('dev')).toBe(false)
    expect(isStrucppCompatibleRuntime(null)).toBe(false)
    expect(isStrucppCompatibleRuntime(undefined)).toBe(false)
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
