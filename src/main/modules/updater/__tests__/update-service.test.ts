/**
 * The update notice (DOPE-486), driven through fakes: when the check runs, what
 * the status bar shows, and how the installer is downloaded, verified and opened.
 */
import type { Release, ReleaseAsset } from '../release-assets'
import {
  createUpdateService,
  type DialogRequest,
  FIRST_CHECK_DELAY_MS,
  RELEASES_URL,
  type UpdateService,
  type UpdateServiceDeps,
  type UpdateStatus,
} from '../update-service'

const SHA = 'a'.repeat(64)
const BASE = 'https://github.com/Autonomy-Logic/openplc-editor/releases/download/v4.3.3/'

/** `null` for an asset GitHub gave no digest. */
function asset(name: string, digest: string | null = `sha256:${SHA}`): ReleaseAsset {
  return { name, url: BASE + name, size: 100, digest: digest ?? undefined }
}

function release(version = '4.3.3', assets = defaultAssets(version)): Release {
  return { version, assets }
}

function defaultAssets(version: string): ReleaseAsset[] {
  return [
    asset(`OpenPLC.Editor_${version}.exe`),
    asset(`OpenPLC.Editor_${version}-ARM64.exe`),
    asset(`OpenPLC_Editor_${version}.dmg`),
    asset(`OpenPLC_Editor_${version}-ARM.dmg`),
    asset(`OpenPLC.Editor-${version}.AppImage`),
    asset(`OpenPLC.Editor-${version}-ARM64.AppImage`),
  ]
}

interface Harness {
  service: UpdateService
  dialogs: DialogRequest[]
  statuses: UpdateStatus[]
  /** Buttons pressed by the next dialogs, in order; after that, the last button. */
  press: (...buttons: number[]) => void
  timers: { ms: number; callback: () => void }[]
  runTimers: () => void
  fetchLatestRelease: jest.Mock<Promise<Release | null>, [boolean]>
  download: jest.Mock
  openInstaller: jest.Mock
  discard: jest.Mock
  openExternal: jest.Mock
  requestQuit: jest.Mock
}

function setup({
  platform = 'linux',
  arch = 'x64',
  currentVersion = '4.3.2',
  isPackaged = true,
  autoCheck = true,
  latest = release(),
  sha256 = SHA,
}: {
  platform?: NodeJS.Platform
  arch?: string
  currentVersion?: string
  isPackaged?: boolean
  autoCheck?: boolean
  latest?: Release | null | Error
  sha256?: string
} = {}): Harness {
  const dialogs: DialogRequest[] = []
  const queued: number[] = []
  let autoCheckStored = autoCheck
  const timers: Harness['timers'] = []
  const fetchLatestRelease = jest.fn<Promise<Release | null>, [boolean]>(() =>
    latest instanceof Error ? Promise.reject(latest) : Promise.resolve(latest),
  )
  const download = jest.fn((file: ReleaseAsset, progress: (fraction: number) => void) => {
    progress(0.5)
    progress(1)
    return Promise.resolve({ path: `/home/user/Downloads/${file.name}`, sha256 })
  })
  const openInstaller = jest.fn(() => Promise.resolve())
  const discard = jest.fn()
  const openExternal = jest.fn()
  const requestQuit = jest.fn()

  const deps: UpdateServiceDeps = {
    isPackaged,
    platform,
    arch,
    currentVersion,
    fetchLatestRelease,
    download,
    discard,
    openInstaller,
    readAutoCheck: () => autoCheckStored,
    writeAutoCheck: (enabled) => {
      autoCheckStored = enabled
    },
    showDialog: (request) => {
      dialogs.push(request)
      return Promise.resolve(queued.shift() ?? request.buttons.length - 1)
    },
    openExternal,
    requestQuit,
    after: (ms, callback) => {
      timers.push({ ms, callback })
    },
    log: jest.fn(),
  }

  const service = createUpdateService(deps)
  const statuses: UpdateStatus[] = []
  service.onStatusChange((status) => statuses.push(status))
  return {
    service,
    dialogs,
    statuses,
    press: (...buttons) => queued.push(...buttons),
    timers,
    runTimers: () => {
      for (const timer of timers.splice(0)) timer.callback()
    },
    fetchLatestRelease,
    download,
    openInstaller,
    discard,
    openExternal,
    requestQuit,
  }
}

/** Let the check's promises settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

const messages = (h: Harness) => h.dialogs.map((dialog) => dialog.message)

describe('automatic check', () => {
  it('runs once, a minute after start, and never again on a timer', async () => {
    const h = setup()
    h.service.start()
    expect(h.timers.map((timer) => timer.ms)).toEqual([FIRST_CHECK_DELAY_MS])

    h.runTimers()
    await settle()
    expect(h.fetchLatestRelease).toHaveBeenCalledTimes(1)
    expect(h.timers).toHaveLength(0)
  })

  it('does not run when the user turned it off', () => {
    const h = setup({ autoCheck: false })
    h.service.start()
    expect(h.timers).toHaveLength(0)
  })

  it('does not run in a development build', () => {
    const h = setup({ isPackaged: false })
    h.service.start()
    expect(h.timers).toHaveLength(0)
  })

  it('shows the Update button for a newer version, with no dialog and no download', async () => {
    const h = setup()
    h.service.start()
    h.runTimers()
    await settle()
    expect(h.service.getStatus()).toEqual({ state: 'available', version: '4.3.3' })
    expect(h.dialogs).toHaveLength(0)
    expect(h.download).not.toHaveBeenCalled()
  })

  it('shows nothing when up to date', async () => {
    const h = setup({ latest: release('4.3.2') })
    h.service.start()
    h.runTimers()
    await settle()
    expect(h.service.getStatus()).toEqual({ state: 'none' })
    expect(h.dialogs).toHaveLength(0)
  })

  it('shows nothing for an older release', async () => {
    const h = setup({ currentVersion: '4.4.0' })
    h.service.start()
    h.runTimers()
    await settle()
    expect(h.service.getStatus()).toEqual({ state: 'none' })
  })

  it('stays silent when offline', async () => {
    const h = setup({ latest: new Error('net::ERR_INTERNET_DISCONNECTED') })
    h.service.start()
    h.runTimers()
    await settle()
    expect(h.dialogs).toHaveLength(0)
    expect(h.service.getStatus()).toEqual({ state: 'none' })
  })

  it('shows nothing when the release has no installer for this computer', async () => {
    const h = setup({ latest: release('4.3.3', [asset('OpenPLC.Editor_4.3.3.exe')]) })
    h.service.start()
    h.runTimers()
    await settle()
    expect(h.service.getStatus()).toEqual({ state: 'none' })
  })

  it('a stable build asks for stable releases only, an rc build for prereleases too', async () => {
    const stable = setup()
    await stable.service.checkNow()
    expect(stable.fetchLatestRelease).toHaveBeenCalledWith(false)

    const rc = setup({ currentVersion: '4.3.3-rc.1', latest: release('4.3.3-rc.2') })
    await rc.service.checkNow()
    expect(rc.fetchLatestRelease).toHaveBeenCalledWith(true)
  })

  it('the toggle is stored for the next launch', () => {
    const h = setup()
    h.service.setAutoCheck(false)
    expect(h.service.isAutoCheckEnabled()).toBe(false)
  })
})

describe('manual check', () => {
  it('says the editor is up to date', async () => {
    const h = setup({ latest: release('4.3.2') })
    await h.service.checkNow()
    expect(messages(h)).toEqual(['OpenPLC Editor is up to date'])
  })

  it('works with automatic checks off', async () => {
    const h = setup({ autoCheck: false })
    h.service.start()
    await h.service.checkNow()
    expect(messages(h)).toEqual(['OpenPLC Editor 4.3.3 is available'])
  })

  it('offers the download, and Later leaves the button', async () => {
    const h = setup()
    h.press(1)
    await h.service.checkNow()
    expect(h.dialogs[0].buttons).toEqual(['Download', 'Later'])
    expect(h.download).not.toHaveBeenCalled()
    expect(h.service.getStatus()).toEqual({ state: 'available', version: '4.3.3' })
  })

  it('Download fetches and opens the installer', async () => {
    const h = setup()
    h.press(0, 1)
    await h.service.checkNow()
    expect(h.download).toHaveBeenCalledTimes(1)
    expect(h.openInstaller).toHaveBeenCalledWith('/home/user/Downloads/OpenPLC.Editor-4.3.3.AppImage')
  })

  it('reports a failed check with the download page', async () => {
    const h = setup({ latest: new Error('503') })
    h.press(0)
    await h.service.checkNow()
    expect(messages(h)).toEqual(['Could not check for updates'])
    expect(h.openExternal).toHaveBeenCalledWith(RELEASES_URL)
  })

  it('in a development build only says updates are off', async () => {
    const h = setup({ isPackaged: false })
    await h.service.checkNow()
    expect(messages(h)).toEqual(['Updates are disabled in development builds'])
    expect(h.fetchLatestRelease).not.toHaveBeenCalled()
  })
})

describe('download and open', () => {
  async function available(options: Parameters<typeof setup>[0] = {}) {
    const h = setup(options)
    h.service.start()
    h.runTimers()
    await settle()
    h.statuses.length = 0
    return h
  }

  it.each([
    ['win32', 'x64', 'OpenPLC.Editor_4.3.3.exe'],
    ['win32', 'arm64', 'OpenPLC.Editor_4.3.3-ARM64.exe'],
    ['darwin', 'x64', 'OpenPLC_Editor_4.3.3.dmg'],
    ['darwin', 'arm64', 'OpenPLC_Editor_4.3.3-ARM.dmg'],
    ['linux', 'x64', 'OpenPLC.Editor-4.3.3.AppImage'],
    ['linux', 'arm64', 'OpenPLC.Editor-4.3.3-ARM64.AppImage'],
  ] as const)('%s %s downloads %s', async (platform, arch, name) => {
    const h = await available({ platform, arch })
    await h.service.downloadAndOpen()
    expect(h.download.mock.calls[0][0]).toMatchObject({ name })
    expect(h.openInstaller).toHaveBeenCalledWith(`/home/user/Downloads/${name}`)
  })

  it('reports progress on the button, then shows it as downloaded', async () => {
    const h = await available()
    await h.service.downloadAndOpen()
    expect(h.statuses).toEqual([
      { state: 'downloading', version: '4.3.3', percent: 0 },
      { state: 'downloading', version: '4.3.3', percent: 50 },
      { state: 'downloading', version: '4.3.3', percent: 100 },
      { state: 'downloaded', version: '4.3.3' },
    ])
  })

  it.each([
    ['win32', 'The OpenPLC Editor 4.3.3 installer is open', /installer can replace/],
    ['darwin', 'The OpenPLC Editor 4.3.3 installer is open', /drag the new version into Applications/],
    ['linux', 'OpenPLC Editor 4.3.3 is downloaded', /saved to \/home\/user\/Downloads/],
  ] as const)('%s: tells the user what is left to do', async (platform, message, detail) => {
    const h = await available({ platform, arch: 'x64' })
    await h.service.downloadAndOpen()
    expect(messages(h)).toEqual([message])
    expect(h.dialogs[0].detail).toMatch(detail)
    expect(h.dialogs[0].buttons).toEqual(['Quit Now', 'Later'])
  })

  it('Quit Now goes through the ordinary quit, with its unsaved-project prompt', async () => {
    const h = await available()
    h.press(0)
    await h.service.downloadAndOpen()
    expect(h.requestQuit).toHaveBeenCalledTimes(1)
  })

  it('Later leaves the editor running', async () => {
    const h = await available()
    await h.service.downloadAndOpen()
    expect(h.requestQuit).not.toHaveBeenCalled()
  })

  it('a second click opens the same file again without downloading', async () => {
    const h = await available()
    await h.service.downloadAndOpen()
    await h.service.downloadAndOpen()
    expect(h.download).toHaveBeenCalledTimes(1)
    expect(h.openInstaller).toHaveBeenCalledTimes(2)
  })

  it('a file whose sha256 does not match is deleted and never opened', async () => {
    const h = await available({ sha256: 'b'.repeat(64) })
    await h.service.downloadAndOpen()
    expect(h.discard).toHaveBeenCalledWith('/home/user/Downloads/OpenPLC.Editor-4.3.3.AppImage')
    expect(h.openInstaller).not.toHaveBeenCalled()
    expect(messages(h)).toEqual(['OpenPLC Editor 4.3.3 could not be verified'])
    expect(h.service.getStatus()).toEqual({ state: 'available', version: '4.3.3' })
  })

  it('an installer without a digest is not downloaded', async () => {
    const h = await available({ latest: release('4.3.3', [asset('OpenPLC.Editor-4.3.3.AppImage', null)]) })
    await h.service.downloadAndOpen()
    expect(h.download).not.toHaveBeenCalled()
    expect(messages(h)).toEqual(['OpenPLC Editor 4.3.3 could not be verified'])
  })

  it('an installer hosted outside the project releases is never offered', async () => {
    const outside = {
      ...asset('OpenPLC.Editor-4.3.3.AppImage'),
      url: 'https://example.com/OpenPLC.Editor-4.3.3.AppImage',
    }
    const h = await available({ latest: release('4.3.3', [outside]) })
    expect(h.service.getStatus()).toEqual({ state: 'none' })
  })

  it('a failed download puts the button back and offers the download page', async () => {
    const h = await available()
    h.download.mockRejectedValueOnce(new Error('ECONNRESET'))
    h.press(0)
    await h.service.downloadAndOpen()
    expect(h.service.getStatus()).toEqual({ state: 'available', version: '4.3.3' })
    expect(messages(h)).toEqual(['OpenPLC Editor 4.3.3 could not be downloaded'])
    expect(h.openExternal).toHaveBeenCalledWith(RELEASES_URL)
  })

  it('a failure to open the installer still tells the user where the file is', async () => {
    const h = await available()
    h.openInstaller.mockRejectedValueOnce(new Error('no handler'))
    await h.service.downloadAndOpen()
    expect(messages(h)).toEqual(['OpenPLC Editor 4.3.3 is downloaded'])
  })

  it('ignores a click while the download runs', async () => {
    const h = await available()
    let finish: () => void = () => undefined
    h.download.mockImplementationOnce(
      (file: ReleaseAsset) =>
        new Promise((resolve) => {
          finish = () => resolve({ path: `/home/user/Downloads/${file.name}`, sha256: SHA })
        }),
    )
    const first = h.service.downloadAndOpen()
    await h.service.downloadAndOpen()
    finish()
    await first
    expect(h.download).toHaveBeenCalledTimes(1)
  })

  it('a manual check during the download says it is under way', async () => {
    const h = await available()
    h.download.mockImplementationOnce(() => new Promise(() => undefined))
    void h.service.downloadAndOpen()
    await h.service.checkNow()
    expect(messages(h)).toEqual(['OpenPLC Editor 4.3.3 is being downloaded'])
  })

  it('does nothing before a newer version is known', async () => {
    const h = setup()
    await h.service.downloadAndOpen()
    expect(h.download).not.toHaveBeenCalled()
  })

  it('an unsubscribed listener hears nothing', async () => {
    const h = await available()
    const listener = jest.fn()
    h.service.onStatusChange(listener)()
    await h.service.downloadAndOpen()
    expect(listener).not.toHaveBeenCalled()
  })
})
