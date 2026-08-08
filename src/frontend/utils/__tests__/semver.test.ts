import {
  compareParsedVersions,
  compareSemver,
  formatVersionForDisplay,
  isCompatibleEditorVersion,
  isValidVersion,
  isVersionAtLeast,
  parseVersion,
} from '../semver'

describe('parseVersion', () => {
  it('parses a plain three-part version', () => {
    expect(parseVersion('4.1.9')).toEqual({ major: 4, minor: 1, patch: 9, prerelease: undefined })
  })

  // A `v` prefix is decoration, not meaning: the runtime reports `v4.2.0`, git
  // tags carry `v`, and hand-written manifests use both. They must compare the
  // same or the same release is two different versions depending on who typed it.
  it('treats a v prefix as identical to no prefix', () => {
    expect(parseVersion('v4.3.2')).toEqual(parseVersion('4.3.2'))
    expect(compareSemver('v4.3.2', '4.3.2')).toBe(0)
    expect(isVersionAtLeast('v4.3.2', '4.3.2')).toBe(true)
    expect(isVersionAtLeast('4.3.2', 'v4.3.2')).toBe(true)
  })

  // A floor written as `"4.3"` means 4.3.0 and is enforced as 4.3.0. Anything
  // else and the same shorthand is honoured by one gate and ignored by another.
  it('fills missing components with zero', () => {
    expect(parseVersion('4.3')).toEqual(parseVersion('4.3.0'))
    expect(parseVersion('4')).toEqual(parseVersion('4.0.0'))
    expect(parseVersion('v4')).toEqual(parseVersion('4.0.0'))
    expect(parseVersion('4.3')).toEqual({ major: 4, minor: 3, patch: 0, prerelease: undefined })
    expect(parseVersion('4')).toEqual({ major: 4, minor: 0, patch: 0, prerelease: undefined })
  })

  it('captures pre-release and build suffixes without failing', () => {
    expect(parseVersion('4.1.0-rc.3')?.prerelease).toBe('rc.3')
    expect(parseVersion('4.1.0+build.5')?.prerelease).toBe('build.5')
    expect(parseVersion('4.1-rc.3')).toEqual({ major: 4, minor: 1, patch: 0, prerelease: 'rc.3' })
  })

  it('tolerates surrounding whitespace', () => {
    expect(parseVersion('  4.1.9  ')).toEqual({ major: 4, minor: 1, patch: 9, prerelease: undefined })
  })

  // Unknown is not a version. It must not silently become 0.0.0 inside the
  // parser, because a caller that cannot tell "unknown" from "0.0.0" cannot
  // fail closed on the first and pass on the second.
  it.each([
    ['dev', 'a source build with no CI tag'],
    ['garbage', 'anything else'],
    ['', 'an empty string'],
    ['   ', 'whitespace only'],
    ['4.1 beta', 'trailing garbage after a valid prefix'],
    ['abc.def.ghi', 'non-numeric components'],
    ['4,3,0', 'the wrong separator'],
    ['.1.2', 'a missing major'],
  ])('returns null for %p (%s)', (input) => {
    expect(parseVersion(input)).toBeNull()
  })

  it('returns null for null and undefined', () => {
    expect(parseVersion(null)).toBeNull()
    expect(parseVersion(undefined)).toBeNull()
  })

  // `Number.parseInt` answers a finite number here and quietly rounds it —
  // 9007199254740993 comes back as …992. A component we can only approximate is
  // not readable, and returning a number that no longer matches the string it
  // came from would break the one promise the parser makes.
  it('rejects a component too large to hold exactly', () => {
    expect(parseVersion('9007199254740993.0.0')).toBeNull()
    expect(parseVersion('4.9007199254740993.0')).toBeNull()
    expect(parseVersion('4.1.9007199254740993')).toBeNull()
    // The largest value that IS exact still parses.
    expect(parseVersion('9007199254740991.0.0')?.major).toBe(9007199254740991)
  })

  it('leaves an oversized version unable to clear any floor', () => {
    // Fails closed as a candidate, declares nothing as a floor — the same
    // treatment every other unreadable string gets.
    expect(isVersionAtLeast('9007199254740993.0.0', '4.1.0')).toBe(false)
    expect(isVersionAtLeast('4.1.0', '9007199254740993.0.0')).toBe(true)
    expect(isValidVersion('9007199254740993.0.0')).toBe(false)
  })
})

describe('isValidVersion', () => {
  it('accepts every shorthand the parser accepts', () => {
    for (const raw of ['4.3.2', 'v4.3.2', '4.3', '4', 'v5', '4.1.0-rc.1', '4.1.0+build.5']) {
      expect(isValidVersion(raw)).toBe(true)
    }
  })

  it('rejects what the parser cannot read', () => {
    for (const raw of ['garbage', 'next', '', '   ', '4,3,0', null, undefined]) {
      expect(isValidVersion(raw)).toBe(false)
    }
  })
})

describe('formatVersionForDisplay', () => {
  it('trims a readable version', () => {
    expect(formatVersionForDisplay('  v4.2.0 ')).toBe('v4.2.0')
  })

  // Every "incompatible versions" message must render an unestablished version
  // the same way. A blank leaves a hole in the sentence and tells the user
  // nothing about which of the two versions could not be read.
  const UNREADABLE: Array<[string | null | undefined, string]> = [
    ['', 'an empty string'],
    ['   ', 'whitespace only'],
    [null, 'null'],
    [undefined, 'undefined'],
  ]

  it.each(UNREADABLE)('renders %p as "unknown" (%s)', (raw) => {
    expect(formatVersionForDisplay(raw)).toBe('unknown')
  })
})

describe('compareParsedVersions', () => {
  const v = (major: number, minor: number, patch: number) => ({ major, minor, patch })

  it('orders by major first', () => {
    expect(compareParsedVersions(v(5, 0, 0), v(4, 9, 9))).toBe(1)
    expect(compareParsedVersions(v(4, 9, 9), v(5, 0, 0))).toBe(-1)
  })

  it('orders by minor when majors match', () => {
    expect(compareParsedVersions(v(4, 2, 0), v(4, 1, 99))).toBe(1)
    expect(compareParsedVersions(v(4, 1, 99), v(4, 2, 0))).toBe(-1)
  })

  it('orders by patch when major and minor match', () => {
    expect(compareParsedVersions(v(4, 1, 10), v(4, 1, 9))).toBe(1)
    expect(compareParsedVersions(v(4, 1, 9), v(4, 1, 10))).toBe(-1)
  })

  it('returns 0 for equal triples', () => {
    expect(compareParsedVersions(v(4, 1, 9), v(4, 1, 9))).toBe(0)
  })

  it('ignores pre-release when ordering', () => {
    // Load-bearing deviation from strict semver: the rc builds on a version
    // line ARE the builds shipping that line's features, so treating them as
    // "less than" the release would reject runtimes that work.
    const rc = { ...v(4, 1, 0), prerelease: 'rc.3' }
    expect(compareParsedVersions(rc, v(4, 1, 0))).toBe(0)
    expect(compareParsedVersions(v(4, 1, 0), rc)).toBe(0)
  })
})

describe('isVersionAtLeast', () => {
  it('passes when the candidate is above the floor', () => {
    expect(isVersionAtLeast('4.2.10', '4.2.1')).toBe(true)
  })

  it('compares numerically, not lexicographically', () => {
    expect(isVersionAtLeast('4.10.0', '4.9.0')).toBe(true)
    expect(isVersionAtLeast('4.9.0', '4.10.0')).toBe(false)
  })

  it('passes when the candidate sits exactly on the floor', () => {
    expect(isVersionAtLeast('4.2.1', '4.2.1')).toBe(true)
  })

  it('fails when the candidate is below the floor', () => {
    expect(isVersionAtLeast('4.2.0', '4.2.1')).toBe(false)
  })

  it('passes a pre-release build of the required version', () => {
    expect(isVersionAtLeast('v4.1.9-rc.1', '4.1.9')).toBe(true)
  })

  // The shorthand case. `"4.3"` as a floor must block a 4.2.10 editor exactly
  // as `"4.3.0"` would — this is the asymmetry that let a runtime publish a
  // floor nobody enforced.
  it('enforces a partial floor exactly as its zero-filled equivalent', () => {
    expect(isVersionAtLeast('4.2.10', '4.3')).toBe(false)
    expect(isVersionAtLeast('4.2.10', '4.3.0')).toBe(false)
    expect(isVersionAtLeast('4.3.0', '4.3')).toBe(true)
    expect(isVersionAtLeast('4.2.10', '5')).toBe(false)
    expect(isVersionAtLeast('5.0.0', '5')).toBe(true)
    expect(isVersionAtLeast('4.2.10', 'v4.3')).toBe(false)
  })

  // A peer that asks for nothing gets nothing enforced — this is what keeps
  // runtimes predating /api/capabilities working unchanged.
  const NOTHING_DECLARED: Array<[string | null | undefined, string]> = [
    [undefined, 'undefined'],
    [null, 'null'],
    ['', 'an empty string'],
  ]

  it.each(NOTHING_DECLARED)('passes when the floor is %p (%s)', (floor) => {
    expect(isVersionAtLeast('4.2.0', floor)).toBe(true)
  })

  // An unreadable floor is worth 0.0.0 and everything clears 0.0.0. It is not
  // silent, though: the manifest schema refuses it outright and the runtime
  // probe logs a warning, so nobody believes a constraint is applying when it
  // is not.
  it('passes when the floor itself is unreadable, since it declares nothing', () => {
    expect(isVersionAtLeast('4.2.0', 'garbage')).toBe(true)
    expect(isVersionAtLeast('4.2.0', 'next')).toBe(true)
  })

  // Fails closed: an unidentifiable peer never clears a real floor.
  const UNIDENTIFIABLE: Array<[string | null | undefined, string]> = [
    ['dev', 'a source build'],
    ['garbage', 'a corrupt value'],
    ['', 'a blank answer'],
    [null, 'an unreachable peer'],
    [undefined, 'a missing value'],
  ]

  it.each(UNIDENTIFIABLE)('fails when the candidate is %p (%s) and a real floor exists', (candidate) => {
    expect(isVersionAtLeast(candidate, '4.1.0')).toBe(false)
  })

  // The legacy hardcoded header now parses (as 4.0.0) instead of being
  // rejected as junk, and still loses — for the honest reason that 4.0.0
  // predates the floor rather than because the string looked odd.
  it('reads the legacy "v4" header as 4.0.0, which still fails a 4.1.0 floor', () => {
    expect(parseVersion('v4')).toEqual({ major: 4, minor: 0, patch: 0, prerelease: undefined })
    expect(isVersionAtLeast('v4', '4.1.0')).toBe(false)
    expect(isVersionAtLeast('v4', '4.0.0')).toBe(true)
  })
})

describe('compareSemver', () => {
  it('returns 0 when versions are identical', () => {
    expect(compareSemver('4.1.1', '4.1.1')).toBe(0)
    expect(compareSemver('0.0.0', '0.0.0')).toBe(0)
  })

  it('returns 1 when the first version is greater (major bump)', () => {
    expect(compareSemver('5.0.0', '4.1.1')).toBe(1)
  })

  it('returns -1 when the first version is smaller (major bump)', () => {
    expect(compareSemver('4.1.1', '5.0.0')).toBe(-1)
  })

  it('compares minor versions when majors match', () => {
    expect(compareSemver('4.2.0', '4.1.99')).toBe(1)
    expect(compareSemver('4.1.0', '4.2.0')).toBe(-1)
  })

  it('compares patch versions when major+minor match', () => {
    expect(compareSemver('4.1.2', '4.1.1')).toBe(1)
    expect(compareSemver('4.1.0', '4.1.1')).toBe(-1)
  })

  it('strips pre-release suffix before comparing', () => {
    expect(compareSemver('4.1.1-rc.1', '4.1.1')).toBe(0)
    expect(compareSemver('4.1.1+build.5', '4.1.1-rc.1')).toBe(0)
  })

  // A v-prefixed catalog version used to parse as 0.0.0 and sort below every
  // plain-numbered release, so "update available" was wrong for it.
  it('ranks a v-prefixed version by its number, not below everything', () => {
    expect(compareSemver('v2.0.0', '1.0.0')).toBe(1)
    expect(compareSemver('1.0.0', 'v2.0.0')).toBe(-1)
    expect(compareSemver('v1.2.3', '1.2.3')).toBe(0)
  })

  // Sorting needs a total order, so this is the one place unknown becomes
  // 0.0.0 — a corrupt `version` in somebody else's manifest sorts to the
  // bottom instead of breaking the catalog. Nothing is gated on the result.
  it('sorts an unreadable version as the lowest possible one', () => {
    expect(compareSemver('not-a-version', '0.0.0')).toBe(0)
    expect(compareSemver('', '0.0.0')).toBe(0)
    expect(compareSemver('1.2', '1.2.0')).toBe(0)
    expect(compareSemver('abc.def.ghi', '0.0.1')).toBe(-1)
    expect(compareSemver('0.0.1', 'abc.def.ghi')).toBe(1)
    expect(compareSemver('garbage', 'nonsense')).toBe(0)
  })
})

describe('isCompatibleEditorVersion', () => {
  it('returns true when no minimum is required', () => {
    expect(isCompatibleEditorVersion(undefined, '4.1.1')).toBe(true)
    expect(isCompatibleEditorVersion('', '4.1.1')).toBe(true)
  })

  it('returns true when the editor is at exactly the required version', () => {
    expect(isCompatibleEditorVersion('4.1.1', '4.1.1')).toBe(true)
  })

  it('returns true when the editor is newer than required', () => {
    expect(isCompatibleEditorVersion('4.0.0', '4.1.1')).toBe(true)
    expect(isCompatibleEditorVersion('3.5.0', '4.1.1')).toBe(true)
  })

  it('returns false when the editor is older than required', () => {
    expect(isCompatibleEditorVersion('5.0.0', '4.1.1')).toBe(false)
    expect(isCompatibleEditorVersion('4.2.0', '4.1.1')).toBe(false)
  })

  // The install gate and the runtime gates must answer identically for every
  // string, or the same floor is enforced in one place and ignored in the
  // other. This is that contract, asserted directly.
  it.each([
    ['4.3', '4.2.10'],
    ['4', '4.2.10'],
    ['v5', '4.2.10'],
    ['4.2.10', '4.2.10'],
    ['garbage', '4.2.10'],
    ['', '4.2.10'],
    ['99.0.0', '4.2.10'],
  ])('agrees with isVersionAtLeast for floor %p against editor %p', (floor, current) => {
    expect(isCompatibleEditorVersion(floor, current)).toBe(isVersionAtLeast(current, floor))
  })
})
