import { installerArchs, pickInstaller, RELEASE_DOWNLOAD_PREFIX, type ReleaseAsset, sha256Of } from '../release-assets'

/** The asset names of the real v4.3.2 release (GitHub turned the spaces into dots). */
const ASSETS: ReleaseAsset[] = [
  'OpenPLC.Editor-4.3.2-ARM64.AppImage',
  'OpenPLC.Editor-4.3.2.AppImage',
  'OpenPLC.Editor_4.3.2-ARM64.exe',
  'OpenPLC.Editor_4.3.2.exe',
  'OpenPLC_Editor_4.3.2-ARM.dmg',
  'OpenPLC_Editor_4.3.2.dmg',
].map((name) => ({ name, url: `${RELEASE_DOWNLOAD_PREFIX}v4.3.2/${name}`, size: 1, digest: undefined }))

describe('pickInstaller', () => {
  it.each([
    ['win32', 'x64', 'OpenPLC.Editor_4.3.2.exe'],
    ['win32', 'arm64', 'OpenPLC.Editor_4.3.2-ARM64.exe'],
    ['darwin', 'x64', 'OpenPLC_Editor_4.3.2.dmg'],
    ['darwin', 'arm64', 'OpenPLC_Editor_4.3.2-ARM.dmg'],
    ['linux', 'x64', 'OpenPLC.Editor-4.3.2.AppImage'],
    ['linux', 'arm64', 'OpenPLC.Editor-4.3.2-ARM64.AppImage'],
  ] as const)('%s %s gets %s', (platform, arch, name) => {
    expect(pickInstaller(ASSETS, platform, arch)?.name).toBe(name)
  })

  it('finds nothing for a platform the editor does not ship', () => {
    expect(pickInstaller(ASSETS, 'freebsd', 'x64')).toBeNull()
  })

  it('never picks a file hosted anywhere else', () => {
    const elsewhere = ASSETS.map((asset) => ({ ...asset, url: `https://example.com/${asset.name}` }))
    expect(pickInstaller(elsewhere, 'linux', 'x64')).toBeNull()
  })
})

describe('sha256Of', () => {
  it('reads a GitHub digest', () => {
    expect(sha256Of(`sha256:${'AB'.repeat(32)}`)).toBe('ab'.repeat(32))
  })

  it.each([undefined, '', 'sha512:abc', `sha256:${'a'.repeat(63)}`])('refuses %p', (digest) => {
    expect(sha256Of(digest)).toBeNull()
  })
})

describe('installerArchs', () => {
  it('a Mac running the Intel build under Rosetta prefers Apple silicon, then Intel', () => {
    expect(installerArchs('darwin', 'x64', true)).toEqual(['arm64', 'x64'])
  })

  it.each([
    ['darwin', 'x64', false, ['x64']],
    ['darwin', 'arm64', false, ['arm64']],
    ['win32', 'x64', true, ['x64']],
    ['win32', 'arm64', false, ['arm64']],
    ['linux', 'x64', false, ['x64']],
  ] as const)('%s %s (translated: %s) keeps %p', (platform, arch, translated, expected) => {
    expect(installerArchs(platform, arch, translated)).toEqual(expected)
  })
})
