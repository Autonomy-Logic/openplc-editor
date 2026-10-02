/**
 * The self-update rules (DOPE-486), driven through a fake electron-updater.
 *
 * Each describe block is one rule from the Requirements Gathering: when checks
 * run, when a download is allowed, when the Update button shows, how an
 * install happens on each platform, and how a failed install stops repeating.
 */
import { EventEmitter } from 'events'

import type { QuitIntent } from '../../lifecycle/quit-coordinator'
import {
  createUpdateService,
  type DialogRequest,
  FIRST_CHECK_DELAY_MS,
  MAC_INSTALL_WATCHDOG_MS,
  RELEASES_URL,
  type UpdateInfoLike,
  type UpdateService,
  type UpdateServiceDeps,
  type UpdateState,
  type UpdateSupport,
} from '../update-service'

class FakeEngine extends EventEmitter {
  autoDownload = true
  autoInstallOnAppQuit = false
  allowDowngrade = true
  /** What the next checkForUpdates reports: an event to emit, or an error to throw. */
  next: { event: 'update-available' | 'update-not-available'; version: string } | { error: Error } | null = null
  checkForUpdates = jest.fn(() => {
    const next = this.next
    if (next && 'error' in next) {
      this.emit('error', next.error)
      return Promise.reject(next.error)
    }
    if (next) this.emit(next.event, { version: next.version } satisfies UpdateInfoLike)
    return Promise.resolve(null)
  })
  downloadUpdate = jest.fn(() => Promise.resolve([]))
  /** What quitAndInstall does on Linux: rename the AppImage, or fail. */
  install: { renamedTo?: string; error?: Error } = {}
  quitAndInstall = jest.fn(() => {
    if (this.install.renamedTo) this.emit('appimage-filename-updated', this.install.renamedTo)
    if (this.install.error) this.emit('error', this.install.error)
  })
  /** electron-updater finished downloading `version`. */
  downloaded(version: string) {
    this.emit('update-downloaded', { version })
  }
}

class FakeSquirrel extends EventEmitter {
  ready() {
    this.emit('update-downloaded')
  }
}

interface Harness {
  service: UpdateService
  engine: FakeEngine
  squirrel: FakeSquirrel
  deps: UpdateServiceDeps
  dialogs: DialogRequest[]
  state: () => UpdateState
  press: (button: number) => void
  timers: { ms: number; callback: () => void; cancelled: boolean }[]
  runTimers: (ms: number) => void
  requestQuit: jest.Mock<void, [QuitIntent]>
  relaunch: jest.Mock<void, [string]>
  quit: jest.Mock
  openExternal: jest.Mock
}

function setup({
  platform = 'linux',
  support = { kind: 'supported', installDir: '/home/user/Applications' },
  currentVersion = '4.3.2',
  writable = true,
  autoCheck = true,
  state = {},
}: {
  platform?: NodeJS.Platform
  support?: UpdateSupport
  currentVersion?: string
  writable?: boolean
  autoCheck?: boolean
  state?: UpdateState
} = {}): Harness {
  const engine = new FakeEngine()
  const squirrel = new FakeSquirrel()
  const dialogs: DialogRequest[] = []
  let nextButton = 1
  let stored: UpdateState = { ...state }
  let autoCheckStored = autoCheck
  const timers: Harness['timers'] = []
  const requestQuit = jest.fn<void, [QuitIntent]>()
  const relaunch = jest.fn<void, [string]>()
  const quit = jest.fn()
  const openExternal = jest.fn()

  const deps: UpdateServiceDeps = {
    engine,
    nativeUpdater: platform === 'darwin' ? squirrel : null,
    platform,
    currentVersion,
    support,
    appImagePath: platform === 'linux' ? '/home/user/Applications/OpenPLC-Editor.AppImage' : undefined,
    isWritable: () => writable,
    readAutoCheck: () => autoCheckStored,
    writeAutoCheck: (enabled) => {
      autoCheckStored = enabled
    },
    readState: () => stored,
    writeState: (next) => {
      stored = next
    },
    showDialog: (request) => {
      dialogs.push(request)
      return Promise.resolve(nextButton)
    },
    openExternal,
    requestQuit,
    relaunch,
    quit,
    after: (ms, callback) => {
      const timer = { ms, callback, cancelled: false }
      timers.push(timer)
      return () => {
        timer.cancelled = true
      }
    },
    log: jest.fn(),
  }

  const service = createUpdateService(deps)
  return {
    service,
    engine,
    squirrel,
    deps,
    dialogs,
    state: () => stored,
    press: (button) => {
      nextButton = button
    },
    timers,
    runTimers: (ms) => {
      for (const timer of [...timers]) if (!timer.cancelled && timer.ms === ms) timer.callback()
    },
    requestQuit,
    relaunch,
    quit,
    openExternal,
  }
}

/** Let the dialog promises and their handlers settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('support', () => {
  it.each<UpdateSupport['kind']>(['development', 'windows', 'not-appimage', 'unstable-location'])(
    'does nothing on its own when %s',
    (kind) => {
      const h = setup({ support: { kind } as UpdateSupport })
      h.service.start()
      expect(h.timers).toHaveLength(0)
      expect(h.engine.listenerCount('update-available')).toBe(0)
    },
  )

  it('opens the releases page on Windows instead of checking', async () => {
    const h = setup({ platform: 'win32', support: { kind: 'windows' } })
    await h.service.checkNow()
    expect(h.openExternal).toHaveBeenCalledWith(RELEASES_URL)
    expect(h.engine.checkForUpdates).not.toHaveBeenCalled()
  })

  it('asks a macOS user outside Applications to move the app', async () => {
    const h = setup({ platform: 'darwin', support: { kind: 'unstable-location' } })
    await h.service.checkNow()
    expect(h.dialogs[0].message).toMatch(/Move OpenPLC Editor to Applications/)
    expect(h.engine.checkForUpdates).not.toHaveBeenCalled()
  })

  it('never downgrades and decides downloads itself', () => {
    const h = setup()
    h.service.start()
    expect(h.engine.allowDowngrade).toBe(false)
    expect(h.engine.autoDownload).toBe(false)
    expect(h.engine.autoInstallOnAppQuit).toBe(true)
  })
})

describe('automatic checks', () => {
  it('run once per launch, a minute after start, and never again on a timer', () => {
    const h = setup()
    h.service.start()
    expect(h.engine.checkForUpdates).not.toHaveBeenCalled()

    h.runTimers(FIRST_CHECK_DELAY_MS)
    expect(h.engine.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(h.timers).toHaveLength(1)
  })

  it('do not run when the user turned them off', () => {
    const h = setup({ autoCheck: false })
    h.service.start()
    expect(h.timers).toHaveLength(0)
    expect(h.engine.checkForUpdates).not.toHaveBeenCalled()
  })

  it('the toggle is stored for the next launch', () => {
    const h = setup()
    h.service.start()
    h.service.setAutoCheck(false)
    expect(h.service.isAutoCheckEnabled()).toBe(false)
  })

  it('a manual check still works with automatic checks off', async () => {
    const h = setup({ autoCheck: false })
    h.service.start()
    h.engine.next = { event: 'update-available', version: '4.3.3' }
    await h.service.checkNow()
    expect(h.engine.downloadUpdate).toHaveBeenCalledTimes(1)
  })

  it('stay silent when offline', async () => {
    const h = setup()
    h.service.start()
    h.engine.next = { error: new Error('net::ERR_INTERNET_DISCONNECTED') }
    h.runTimers(FIRST_CHECK_DELAY_MS)
    await settle()
    expect(h.dialogs).toHaveLength(0)
  })

  it('stay silent when up to date', async () => {
    const h = setup()
    h.service.start()
    h.engine.next = { event: 'update-not-available', version: '4.3.2' }
    h.runTimers(FIRST_CHECK_DELAY_MS)
    await settle()
    expect(h.dialogs).toHaveLength(0)
  })
})

describe('manual check', () => {
  it('says the editor is up to date', async () => {
    const h = setup()
    h.service.start()
    h.engine.next = { event: 'update-not-available', version: '4.3.2' }
    await h.service.checkNow()
    expect(h.dialogs[0].message).toBe('OpenPLC Editor is up to date')
  })

  it('says a newer version is being rolled out when this computer is outside the stage', async () => {
    const h = setup()
    h.service.start()
    h.engine.next = { event: 'update-not-available', version: '4.3.3' }
    await h.service.checkNow()
    expect(h.dialogs[0].message).toBe('OpenPLC Editor 4.3.3 is being rolled out')
  })

  it('reports a failed check with the download page', async () => {
    const h = setup()
    h.service.start()
    h.engine.next = { error: new Error('503') }
    h.press(0)
    await h.service.checkNow()
    await settle()
    expect(h.dialogs[0].message).toBe('Could not check for updates')
    expect(h.openExternal).toHaveBeenCalledWith(RELEASES_URL)
  })
})

describe('download', () => {
  it('starts when an update is found and the location is writable', async () => {
    const h = setup()
    h.service.start()
    h.engine.next = { event: 'update-available', version: '4.3.3' }
    h.runTimers(FIRST_CHECK_DELAY_MS)
    await settle()
    expect(h.engine.downloadUpdate).toHaveBeenCalledTimes(1)
    expect(h.dialogs).toHaveLength(0)
  })

  it('is skipped where the editor cannot write, with one notice per version', async () => {
    const h = setup({ writable: false })
    h.service.start()
    h.engine.next = { event: 'update-available', version: '4.3.3' }
    h.runTimers(FIRST_CHECK_DELAY_MS)
    await settle()
    expect(h.engine.downloadUpdate).not.toHaveBeenCalled()
    expect(h.dialogs.map((dialog) => dialog.message)).toEqual(['OpenPLC Editor 4.3.3 is available'])
    expect(h.state().notifiedVersion).toBe('4.3.3')
  })

  it('does not repeat the cannot-install notice on the next launch for the same version', async () => {
    const h = setup({ writable: false, state: { notifiedVersion: '4.3.3' } })
    h.service.start()
    h.engine.next = { event: 'update-available', version: '4.3.3' }
    h.runTimers(FIRST_CHECK_DELAY_MS)
    await settle()
    expect(h.dialogs).toHaveLength(0)
  })

  it('never fetches a version that already failed to install', async () => {
    const h = setup({ state: { failedVersion: '4.3.3' } })
    h.service.start()
    h.engine.next = { event: 'update-available', version: '4.3.3' }
    h.runTimers(FIRST_CHECK_DELAY_MS)
    await settle()
    expect(h.engine.downloadUpdate).not.toHaveBeenCalled()
    expect(h.dialogs).toHaveLength(0)
  })

  it('fetches a newer version after a failed one', async () => {
    const h = setup({ state: { failedVersion: '4.3.3' } })
    h.service.start()
    h.engine.next = { event: 'update-available', version: '4.3.4' }
    h.runTimers(FIRST_CHECK_DELAY_MS)
    await settle()
    expect(h.engine.downloadUpdate).toHaveBeenCalledTimes(1)
  })
})

describe('ready to install', () => {
  it('on Linux, shows the Update button, not a dialog, when an automatic download finishes', async () => {
    const h = setup()
    h.service.start()
    const seen: unknown[] = []
    h.service.onStatusChange((status) => seen.push(status))
    expect(h.service.getStatus()).toEqual({ state: 'none' })

    h.engine.downloaded('4.3.3')
    await settle()
    expect(h.service.getStatus()).toEqual({ state: 'ready', version: '4.3.3' })
    expect(h.dialogs).toHaveLength(0)
    expect(h.state().pendingVersion).toBe('4.3.3')

    h.engine.downloaded('4.3.3')
    expect(seen).toEqual([{ state: 'ready', version: '4.3.3' }])
  })

  it('on macOS, waits for Squirrel before showing it', async () => {
    const h = setup({ platform: 'darwin', support: { kind: 'supported', installDir: '/Applications' } })
    h.service.start()
    h.engine.downloaded('4.3.3')
    await settle()
    expect(h.service.getStatus()).toEqual({ state: 'none' })

    h.squirrel.ready()
    expect(h.service.getStatus()).toEqual({ state: 'ready', version: '4.3.3' })
  })

  it('the Update button asks the quit coordinator, which runs the unsaved-project prompt', () => {
    const h = setup()
    h.service.start()
    h.engine.downloaded('4.3.3')
    h.service.requestInstall()
    expect(h.requestQuit).toHaveBeenCalledWith('install-update')
    expect(h.engine.quitAndInstall).not.toHaveBeenCalled()
  })

  it('the Update button does nothing before the update is ready', () => {
    const h = setup({ platform: 'darwin', support: { kind: 'supported', installDir: '/Applications' } })
    h.service.start()
    h.engine.downloaded('4.3.3')
    h.service.requestInstall()
    expect(h.requestQuit).not.toHaveBeenCalled()
  })

  it('an unsubscribed listener hears nothing', () => {
    const h = setup()
    h.service.start()
    const listener = jest.fn()
    h.service.onStatusChange(listener)()
    h.engine.downloaded('4.3.3')
    expect(listener).not.toHaveBeenCalled()
  })

  it('a manual check that downloads asks to restart when it is done', async () => {
    const h = setup()
    h.service.start()
    h.engine.next = { event: 'update-available', version: '4.3.3' }
    await h.service.checkNow()
    h.press(0)
    h.engine.downloaded('4.3.3')
    await settle()
    expect(h.dialogs.map((dialog) => dialog.message)).toEqual([
      'Downloading OpenPLC Editor 4.3.3',
      'OpenPLC Editor 4.3.3 is ready to install',
    ])
    expect(h.requestQuit).toHaveBeenCalledWith('install-update')
  })

  it('Later from that dialog leaves the install for the next quit, and the button stays', async () => {
    const h = setup()
    h.service.start()
    h.engine.next = { event: 'update-available', version: '4.3.3' }
    await h.service.checkNow()
    h.press(1)
    h.engine.downloaded('4.3.3')
    await settle()
    expect(h.requestQuit).not.toHaveBeenCalled()
    expect(h.engine.autoInstallOnAppQuit).toBe(true)
    expect(h.service.getStatus()).toEqual({ state: 'ready', version: '4.3.3' })
  })

  it('a manual check once it is downloaded offers it again, without checking', async () => {
    const h = setup()
    h.service.start()
    h.engine.downloaded('4.3.3')
    await h.service.checkNow()
    expect(h.dialogs.map((dialog) => dialog.message)).toEqual(['OpenPLC Editor 4.3.3 is ready to install'])
    expect(h.engine.checkForUpdates).not.toHaveBeenCalled()
  })

  it('a manual check during the download asks to restart when it is done', async () => {
    const h = setup()
    h.service.start()
    h.engine.downloadUpdate.mockReturnValue(new Promise(() => undefined))
    h.engine.next = { event: 'update-available', version: '4.3.3' }
    h.runTimers(FIRST_CHECK_DELAY_MS)
    await settle()
    await h.service.checkNow()
    h.engine.downloaded('4.3.3')
    await settle()
    expect(h.dialogs.map((dialog) => dialog.message)).toEqual([
      'An update is already being downloaded',
      'OpenPLC Editor 4.3.3 is ready to install',
    ])
  })

  it('a manual check during the automatic check is answered by that check', async () => {
    const h = setup()
    h.service.start()
    let finish: () => void = () => undefined
    h.engine.checkForUpdates.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => {
            h.engine.emit('update-not-available', { version: '4.3.2' })
            resolve(null)
          }
        }),
    )
    h.runTimers(FIRST_CHECK_DELAY_MS)
    await h.service.checkNow()
    finish()
    await settle()
    expect(h.dialogs.map((dialog) => dialog.message)).toEqual(['OpenPLC Editor is up to date'])
    expect(h.engine.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('a failed install takes the button away', async () => {
    const h = setup()
    h.service.start()
    h.engine.install = { error: new Error('EACCES') }
    h.engine.downloaded('4.3.3')
    h.service.installAndRestart()
    expect(h.service.getStatus()).toEqual({ state: 'none' })
  })
})

describe('install and restart', () => {
  async function downloadedOnLinux(install: FakeEngine['install'] = {}) {
    const h = setup()
    h.service.start()
    h.engine.install = install
    h.engine.downloaded('4.3.3')
    await settle()
    return h
  }

  it('on Linux, installs without launching and relaunches the same file once', async () => {
    const h = await downloadedOnLinux()
    h.service.installAndRestart()
    expect(h.engine.quitAndInstall).toHaveBeenCalledWith(true, false)
    expect(h.relaunch).toHaveBeenCalledTimes(1)
    expect(h.relaunch).toHaveBeenCalledWith('/home/user/Applications/OpenPLC-Editor.AppImage')
    // The updater quits by itself after installing.
    expect(h.quit).not.toHaveBeenCalled()
  })

  it('on Linux, relaunches the renamed AppImage when the name changed', async () => {
    const h = await downloadedOnLinux({ renamedTo: '/home/user/Applications/OpenPLC-Editor-4.3.3.AppImage' })
    h.service.installAndRestart()
    expect(h.relaunch).toHaveBeenCalledTimes(1)
    expect(h.relaunch).toHaveBeenCalledWith('/home/user/Applications/OpenPLC-Editor-4.3.3.AppImage')
  })

  it('on Linux, a failed install reopens the old editor and marks the version failed', async () => {
    const h = await downloadedOnLinux({ error: new Error('EACCES') })
    h.service.installAndRestart()
    expect(h.relaunch).toHaveBeenCalledWith('/home/user/Applications/OpenPLC-Editor.AppImage')
    // Deferred: the quit coordinator destroys the window first.
    expect(h.quit).not.toHaveBeenCalled()
    h.runTimers(0)
    expect(h.quit).toHaveBeenCalledTimes(1)
    expect(h.state().failedVersion).toBe('4.3.3')
  })

  it('on macOS, hands over to Squirrel and quits if it does not within the watchdog', async () => {
    const h = setup({ platform: 'darwin', support: { kind: 'supported', installDir: '/Applications' } })
    h.service.start()
    h.engine.downloaded('4.3.3')
    h.squirrel.ready()
    await settle()

    h.service.installAndRestart()
    expect(h.engine.quitAndInstall).toHaveBeenCalledWith()
    expect(h.quit).not.toHaveBeenCalled()
    h.runTimers(MAC_INSTALL_WATCHDOG_MS)
    expect(h.quit).toHaveBeenCalledTimes(1)
  })

  it('just quits when nothing is ready', () => {
    const h = setup()
    h.service.start()
    h.service.installAndRestart()
    expect(h.engine.quitAndInstall).not.toHaveBeenCalled()
    h.runTimers(0)
    expect(h.quit).toHaveBeenCalledTimes(1)
  })
})

describe('failed install detection', () => {
  it('clears the pending version once the new one is running', () => {
    const h = setup({ currentVersion: '4.3.3', state: { pendingVersion: '4.3.3', installAttempts: 1 } })
    h.service.start()
    expect(h.state()).toEqual({})
  })

  it('does not blame the first start on the old version: it may follow a crash', () => {
    const h = setup({ state: { pendingVersion: '4.3.3', installAttempts: 0 } })
    h.service.start()
    expect(h.state()).toEqual({ pendingVersion: '4.3.3', installAttempts: 1 })
  })

  it('marks the version failed on the second start, and says so once', async () => {
    const h = setup({ state: { pendingVersion: '4.3.3', installAttempts: 1 } })
    h.service.start()
    expect(h.state()).toEqual({ failedVersion: '4.3.3' })

    h.runTimers(FIRST_CHECK_DELAY_MS)
    await settle()
    expect(h.dialogs.map((dialog) => dialog.message)).toEqual(['OpenPLC Editor 4.3.3 could not be installed'])
  })

  it('orders release candidates, so rc.1 running with rc.2 pending is not installed yet', () => {
    const h = setup({ currentVersion: '4.3.3-rc.1', state: { pendingVersion: '4.3.3-rc.2', installAttempts: 0 } })
    h.service.start()
    expect(h.state().installAttempts).toBe(1)
  })
})
