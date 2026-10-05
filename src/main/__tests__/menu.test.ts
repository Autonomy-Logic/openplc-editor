/**
 * Project-only menu items are disabled until the renderer reports an open project. A disabled
 * item's accelerator does not fire either, so this is what keeps their shortcuts off the start
 * screen on every platform.
 */

import type { BrowserWindow, MenuItemConstructorOptions } from 'electron'

import MenuBuilder from '../menu'

jest.mock('electron', () => ({
  Menu: {
    buildFromTemplate: jest.fn((template: unknown) => template),
    setApplicationMenu: jest.fn(),
    getApplicationMenu: jest.fn(() => null),
  },
  nativeTheme: { shouldUseDarkColors: false, themeSource: 'system' },
  shell: { openExternal: jest.fn() },
}))

jest.mock('@root/frontend/locales/i18n', () => ({ i18n: { t: (key: string) => key } }))

jest.mock('../../backend/editor/services', () => ({
  ProjectService: jest.fn(() => ({
    getHistoryProjectsFilePath: jest.fn(() => '/history.json'),
    readProjectHistory: jest.fn(() => Promise.resolve([])),
  })),
}))

jest.mock('../modules/store', () => ({ store: { get: jest.fn(() => 'light') } }))

const PROJECT_ONLY = [
  'menu:file.submenu.save',
  'menu:file.submenu.saveProject',
  'menu:file.submenu.saveAs',
  'menu:file.submenu.closeTab',
  'menu:file.submenu.closeProject',
  'menu:file.submenu.exportToPLCOpenXml',
  'menu:file.submenu.exportToCodesysXml',
  'menu:file.submenu.pageSetup',
  'menu:file.submenu.preview',
  'menu:file.submenu.print',
  'Board Package Manager...',
  'menu:edit.submenu.findInProject',
  'menu:edit.submenu.deletePou',
  'menu:display.submenu.switchPerspective',
]

const ALWAYS_AVAILABLE = [
  'menu:file.submenu.newProject',
  'menu:file.submenu.openProject',
  'menu:file.submenu.retrieveProject',
  'menu:edit.submenu.cut',
  'menu:edit.submenu.copy',
  'menu:edit.submenu.paste',
  'menu:display.submenu.fullScreen',
  'menu:display.submenu.theme',
  'menu:help.submenu.communitySupport',
  'menu:help.submenu.documentation',
  'menu:help.submenu.about',
]

const { Menu } = jest.requireMock<{
  Menu: { buildFromTemplate: jest.Mock; setApplicationMenu: jest.Mock }
}>('electron')

const mainWindow = {
  isDestroyed: () => false,
  webContents: { send: jest.fn(), on: jest.fn(), removeListener: jest.fn() },
}

function newBuilder(): MenuBuilder {
  // @ts-expect-error: a BrowserWindow stand-in with only what MenuBuilder touches
  const window: BrowserWindow = mainWindow
  return new MenuBuilder(window)
}

function items(template: MenuItemConstructorOptions[]): Map<string, MenuItemConstructorOptions> {
  const byLabel = new Map<string, MenuItemConstructorOptions>()
  const walk = (entries: MenuItemConstructorOptions[]) => {
    for (const entry of entries) {
      if (entry.label) byLabel.set(entry.label, entry)
      if (Array.isArray(entry.submenu)) walk(entry.submenu)
    }
  }
  walk(template)
  return byLabel
}

function lastMenu(): Map<string, MenuItemConstructorOptions> {
  const calls = Menu.setApplicationMenu.mock.calls
  const template: unknown = calls[calls.length - 1]?.[0]
  if (!Array.isArray(template)) throw new Error('no menu was set')
  return items(template)
}

const originalPlatform = process.platform

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform })
}

afterAll(() => setPlatform(originalPlatform))

beforeEach(() => jest.clearAllMocks())

describe.each(['darwin', 'win32', 'linux'] as const)('%s', (platform) => {
  beforeEach(() => setPlatform(platform))

  it('disables every project-only item until a project opens', async () => {
    await newBuilder().buildMenu()

    const menu = lastMenu()
    for (const label of PROJECT_ONLY) expect([label, menu.get(label)?.enabled]).toEqual([label, false])
  })

  it('enables them once a project is open, and disables them again when it closes', async () => {
    const builder = newBuilder()
    await builder.buildMenu()

    await builder.setProjectOpen(true)
    const open = lastMenu()
    for (const label of PROJECT_ONLY) expect([label, open.get(label)?.enabled]).toEqual([label, true])

    await builder.setProjectOpen(false)
    const closed = lastMenu()
    for (const label of PROJECT_ONLY) expect([label, closed.get(label)?.enabled]).toEqual([label, false])
  })

  it('leaves the items that need no project available on the start screen', async () => {
    await newBuilder().buildMenu()

    const menu = lastMenu()
    for (const label of ALWAYS_AVAILABLE) {
      expect(menu.has(label)).toBe(true)
      expect([label, menu.get(label)?.enabled]).not.toEqual([label, false])
    }
  })
})

describe.each(['win32', 'linux'] as const)('%s undo and redo', (platform) => {
  beforeEach(() => setPlatform(platform))

  it('are off until a project opens, so Ctrl+Z reaches the focused field', async () => {
    const builder = newBuilder()
    await builder.buildMenu()
    expect(lastMenu().get('menu:edit.submenu.undo')?.enabled).toBe(false)
    expect(lastMenu().get('menu:edit.submenu.redo')?.enabled).toBe(false)

    await builder.setProjectOpen(true)
    expect(lastMenu().get('menu:edit.submenu.undo')?.enabled).toBe(true)
    expect(lastMenu().get('menu:edit.submenu.redo')?.enabled).toBe(true)
  })
})

describe('darwin text editing', () => {
  beforeEach(() => setPlatform('darwin'))

  it('routes undo and redo to the focused field while no project is open', async () => {
    await newBuilder().buildMenu()

    const menu = lastMenu()
    expect(menu.get('menu:edit.submenu.undo')).toMatchObject({ role: 'undo', accelerator: 'Cmd+Z' })
    expect(menu.get('menu:edit.submenu.redo')).toMatchObject({ role: 'redo', accelerator: 'Cmd+Shift+Z' })
    expect(menu.get('menu:edit.submenu.undo')?.click).toBeUndefined()
  })

  it('hands undo and redo to the project history once a project is open', async () => {
    const builder = newBuilder()
    await builder.setProjectOpen(true)

    const menu = lastMenu()
    for (const label of ['menu:edit.submenu.undo', 'menu:edit.submenu.redo']) {
      expect(menu.get(label)?.role).toBeUndefined()
      expect(typeof menu.get(label)?.click).toBe('function')
    }
  })

  it.each([
    ['menu:edit.submenu.cut', 'cut'],
    ['menu:edit.submenu.copy', 'copy'],
    ['menu:edit.submenu.paste', 'paste'],
    ['menu:edit.submenu.selectAll', 'selectAll'],
  ])('%s uses the %s role and is enabled', async (label, role) => {
    await newBuilder().buildMenu()

    const item = lastMenu().get(label)
    expect(item?.role).toBe(role)
    expect(item?.enabled).not.toBe(false)
  })
})

describe('setProjectOpen', () => {
  it('does not rebuild the menu when the state has not changed', async () => {
    const builder = newBuilder()

    await builder.setProjectOpen(false)
    expect(Menu.setApplicationMenu).not.toHaveBeenCalled()

    await builder.setProjectOpen(true)
    await builder.setProjectOpen(true)
    expect(Menu.setApplicationMenu).toHaveBeenCalledTimes(1)
  })
})

describe.each(['darwin', 'win32', 'linux'] as const)('%s updates', (platform) => {
  beforeEach(() => setPlatform(platform))

  function updates(autoCheck = true) {
    return {
      start: jest.fn(),
      checkNow: jest.fn(() => Promise.resolve()),
      isAutoCheckEnabled: jest.fn(() => autoCheck),
      setAutoCheck: jest.fn(),
      getStatus: jest.fn(() => ({ state: 'none' as const })),
      onStatusChange: jest.fn(() => () => undefined),
      downloadAndOpen: jest.fn(() => Promise.resolve()),
    }
  }

  function builderWith(service: ReturnType<typeof updates>): MenuBuilder {
    // @ts-expect-error: a BrowserWindow stand-in with only what MenuBuilder touches
    const window: BrowserWindow = mainWindow
    return new MenuBuilder(window, service)
  }

  it('Check for Updates runs a manual check and has no accelerator (Ctrl+U is Monaco cursor undo)', async () => {
    const service = updates()
    await builderWith(service).buildMenu()

    const item = lastMenu().get('menu:file.submenu.updates')
    expect(item?.enabled).toBe(true)
    expect(item?.accelerator).toBeUndefined()
    // @ts-expect-error: the click handler ignores its Electron arguments
    item?.click?.()
    expect(service.checkNow).toHaveBeenCalledTimes(1)
  })

  it('the automatic toggle shows and stores the preference', async () => {
    const service = updates(false)
    await builderWith(service).buildMenu()

    const toggle = lastMenu().get('Check for Updates Automatically')
    expect(toggle).toMatchObject({ type: 'checkbox', checked: false, enabled: true })
    // @ts-expect-error: only `checked` of the MenuItem is read
    toggle?.click?.({ checked: true })
    expect(service.setAutoCheck).toHaveBeenCalledWith(true)
  })

  it('both items are off when there is no updater', async () => {
    await newBuilder().buildMenu()

    expect(lastMenu().get('menu:file.submenu.updates')?.enabled).toBe(false)
    expect(lastMenu().get('Check for Updates Automatically')?.enabled).toBe(false)
  })
})
