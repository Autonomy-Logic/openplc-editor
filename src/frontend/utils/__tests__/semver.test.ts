import { compareSemver, isCompatibleEditorVersion } from '../semver'

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
