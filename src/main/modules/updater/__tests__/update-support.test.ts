import { detectUpdateSupport } from '../update-support'

const MAC_BINARY = '/Applications/OpenPLC Editor.app/Contents/MacOS/OpenPLC Editor'

describe('detectUpdateSupport', () => {
  it('is off in a development build', () => {
    expect(
      detectUpdateSupport({ isPackaged: false, platform: 'darwin', execPath: MAC_BINARY, appImagePath: undefined }),
    ).toEqual({
      kind: 'development',
    })
  })

  it('is off on Windows until the installers are signed', () => {
    expect(
      detectUpdateSupport({
        isPackaged: true,
        platform: 'win32',
        execPath: 'C:\\OpenPLC Editor.exe',
        appImagePath: undefined,
      }),
    ).toEqual({ kind: 'windows' })
  })

  it('installs a macOS app into the folder holding the .app', () => {
    expect(
      detectUpdateSupport({ isPackaged: true, platform: 'darwin', execPath: MAC_BINARY, appImagePath: undefined }),
    ).toEqual({
      kind: 'supported',
      installDir: '/Applications',
    })
  })

  it.each([
    '/Volumes/OpenPLC Editor v4/OpenPLC Editor.app/Contents/MacOS/OpenPLC Editor',
    '/private/var/folders/x/AppTranslocation/ABC/d/OpenPLC Editor.app/Contents/MacOS/OpenPLC Editor',
  ])('is off for a macOS app running from %s', (execPath) => {
    expect(detectUpdateSupport({ isPackaged: true, platform: 'darwin', execPath, appImagePath: undefined })).toEqual({
      kind: 'unstable-location',
    })
  })

  it('installs a Linux AppImage beside itself', () => {
    expect(
      detectUpdateSupport({
        isPackaged: true,
        platform: 'linux',
        execPath: '/tmp/.mount_OpenPLabc/open-plc-editor',
        appImagePath: '/home/user/Applications/OpenPLC-Editor.AppImage',
      }),
    ).toEqual({ kind: 'supported', installDir: '/home/user/Applications' })
  })

  it('is off on Linux when not started from an AppImage', () => {
    expect(
      detectUpdateSupport({
        isPackaged: true,
        platform: 'linux',
        execPath: '/opt/openplc/open-plc-editor',
        appImagePath: undefined,
      }),
    ).toEqual({ kind: 'not-appimage' })
  })
})
