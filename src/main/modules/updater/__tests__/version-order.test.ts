import { compareVersions, isNewer } from '../version-order'

describe('compareVersions', () => {
  it.each([
    ['4.3.2', '4.3.3', -1],
    ['4.3.3', '4.3.2', 1],
    ['4.3.3', '4.3.3', 0],
    ['v4.3.3', '4.3.3', 0],
    ['4.10.0', '4.9.9', 1],
    ['4.3.3-rc.1', '4.3.3', -1],
    ['4.3.3', '4.3.3-rc.9', 1],
    ['4.3.3-rc.1', '4.3.3-rc.2', -1],
    ['4.3.3-rc.10', '4.3.3-rc.9', 1],
    ['4.3.3-beta.1', '4.3.3-rc.1', -1],
    ['4.3.3-rc', '4.3.3-rc.1', -1],
    ['4.3.3+build.5', '4.3.3', 0],
  ])('%s vs %s is %i', (a, b, expected) => {
    expect(compareVersions(a, b)).toBe(expected)
  })

  it('refuses what is not a version', () => {
    expect(compareVersions('dev', '4.3.3')).toBeNull()
    expect(compareVersions('4.3', '4.3.3')).toBeNull()
  })
})

describe('isNewer', () => {
  it('is false for unreadable versions', () => {
    expect(isNewer('garbage', '4.3.3')).toBe(false)
  })
})
