import {
  compareParsedVersions,
  compareSemver,
  isCompatibleEditorVersion,
  isVersionAtLeast,
  parseVersionLenient,
  parseVersionStrict,
} from '../semver'

describe('parseVersionStrict', () => {
  it('parses a plain three-part version', () => {
    expect(parseVersionStrict('4.1.9')).toEqual({ major: 4, minor: 1, patch: 9, prerelease: undefined })
  })

  it('accepts the tag-style v prefix the runtime reports', () => {
    expect(parseVersionStrict('v4.2.0')).toEqual({ major: 4, minor: 2, patch: 0, prerelease: undefined })
  })

  it('captures pre-release and build suffixes without failing', () => {
    expect(parseVersionStrict('4.1.0-rc.3')?.prerelease).toBe('rc.3')
    expect(parseVersionStrict('4.1.0+build.5')?.prerelease).toBe('build.5')
  })

  it('tolerates surrounding whitespace', () => {
    expect(parseVersionStrict('  4.1.9  ')).toEqual({ major: 4, minor: 1, patch: 9, prerelease: undefined })
  })

  // The whole point of the strict parser: these are the values a runtime in
  // the field actually reports when it cannot identify itself, and every one
  // of them must stay unparseable so a gate fails closed instead of guessing.
  it.each([
    ['v4', 'the legacy hardcoded header'],
    ['4.1', 'a two-part version'],
    ['dev', 'a source build with no CI tag'],
    ['garbage', 'anything else'],
    ['', 'an empty string'],
  ])('returns null for %p (%s)', (input) => {
    expect(parseVersionStrict(input)).toBeNull()
  })

  it('returns null for null and undefined', () => {
    expect(parseVersionStrict(null)).toBeNull()
    expect(parseVersionStrict(undefined)).toBeNull()
  })
})

describe('parseVersionLenient', () => {
  it('parses a plain three-part version', () => {
    expect(parseVersionLenient('4.1.9')).toEqual({ major: 4, minor: 1, patch: 9 })
  })

  it('fills missing components with zero', () => {
    expect(parseVersionLenient('4.1')).toEqual({ major: 4, minor: 1, patch: 0 })
    expect(parseVersionLenient('4')).toEqual({ major: 4, minor: 0, patch: 0 })
  })

  it('strips the v prefix and any suffix before parsing', () => {
    expect(parseVersionLenient('v4.1.9')).toEqual({ major: 4, minor: 1, patch: 9 })
    expect(parseVersionLenient('4.1.9-rc.1')).toEqual({ major: 4, minor: 1, patch: 9 })
    expect(parseVersionLenient('4.1.9+build.5')).toEqual({ major: 4, minor: 1, patch: 9 })
  })

  // Degrading to the lowest possible version means a corrupt manifest field
  // loses every comparison rather than winning one.
  it.each([
    ['garbage', 'a non-numeric string'],
    ['abc.def.ghi', 'non-numeric components'],
    ['', 'an empty string'],
  ])('degrades %p to 0.0.0 (%s)', (input) => {
    expect(parseVersionLenient(input)).toEqual({ major: 0, minor: 0, patch: 0 })
  })

  it('degrades null and undefined to 0.0.0', () => {
    expect(parseVersionLenient(null)).toEqual({ major: 0, minor: 0, patch: 0 })
    expect(parseVersionLenient(undefined)).toEqual({ major: 0, minor: 0, patch: 0 })
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

  it('passes when the candidate sits exactly on the floor', () => {
    expect(isVersionAtLeast('4.2.1', '4.2.1')).toBe(true)
  })

  it('fails when the candidate is below the floor', () => {
    expect(isVersionAtLeast('4.2.0', '4.2.1')).toBe(false)
  })

  it('passes a pre-release build of the required version', () => {
    expect(isVersionAtLeast('v4.1.9-rc.1', '4.1.9')).toBe(true)
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

  it('passes when the floor itself is unparseable, since it declares nothing', () => {
    expect(isVersionAtLeast('4.2.0', 'garbage')).toBe(true)
    expect(isVersionAtLeast('4.2.0', 'v4')).toBe(true)
  })

  // Fails closed: an unidentifiable peer never clears a real floor.
  const UNIDENTIFIABLE: Array<[string | null | undefined, string]> = [
    ['v4', 'the legacy header'],
    ['dev', 'a source build'],
    ['garbage', 'a corrupt value'],
    [null, 'an unreachable peer'],
    [undefined, 'a missing value'],
  ]

  it.each(UNIDENTIFIABLE)('fails when the candidate is %p (%s) and a real floor exists', (candidate) => {
    expect(isVersionAtLeast(candidate, '4.1.0')).toBe(false)
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
    // The function intentionally ignores pre-release ordering; both compare
    // as the same `4.1.1` triple. If we ever ship pre-releases for real this
    // contract needs revisiting, but ignoring is the safer default today.
    expect(compareSemver('4.1.1-rc.1', '4.1.1')).toBe(0)
    expect(compareSemver('4.1.1+build.5', '4.1.1-rc.1')).toBe(0)
  })

  it('treats malformed inputs as 0.0.0 (defensive against corrupt manifests)', () => {
    expect(compareSemver('not-a-version', '0.0.0')).toBe(0)
    expect(compareSemver('', '0.0.0')).toBe(0)
    expect(compareSemver('1.2', '1.2.0')).toBe(0) // missing patch defaults to 0
    expect(compareSemver('abc.def.ghi', '0.0.1')).toBe(-1) // bogus < 0.0.1
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
})
