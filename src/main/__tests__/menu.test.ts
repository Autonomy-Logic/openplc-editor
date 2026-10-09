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

const mockHistory: { name: string; path: string }[] = []
const mockOpenProjectByPath = jest.fn()

jest.mock('../../backend/editor/services', () => ({
  ProjectService: jest.fn(() => ({
    getHistoryProjectsFilePath: jest.fn(() => '/history.json'),
    readProjectHistory: jest.fn(() => Promise.resolve(mockHistory)),
    openProjectByPath: mockOpenProjectByPath,
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

describe('darwin app menu', () => {
  beforeEach(() => setPlatform('darwin'))

  it('labels the app items with the product name instead of the package name', async () => {
    await newBuilder().buildMenu()

    const menu = lastMenu()
    expect(menu.get('OpenPLC Editor')?.role).toBeUndefined()
    expect(menu.get('About OpenPLC Editor')?.role).toBe('about')
    expect(menu.get('Hide OpenPLC Editor')?.role).toBe('hide')
    expect(menu.get('Quit OpenPLC Editor')?.role).toBe('quit')
  })

  it('keeps the remaining native app menu roles', async () => {
    await newBuilder().buildMenu()

    const appMenu = lastMenu().get('OpenPLC Editor')?.submenu
    if (!Array.isArray(appMenu)) throw new Error('app menu has no submenu')
    expect(appMenu.map((entry) => entry.role).filter(Boolean)).toEqual([
      'about',
      'services',
      'hide',
      'hideOthers',
      'unhide',
      'quit',
    ])
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

describe.each(['darwin', 'win32', 'linux'] as const)('%s Recent', (platform) => {
  beforeEach(() => {
    setPlatform(platform)
    mockHistory.splice(0, mockHistory.length, { name: 'demo', path: '/projects/demo' })
  })

  afterEach(() => mockHistory.splice(0, mockHistory.length))

  it('sends the project path to the renderer without reading the project itself', async () => {
    await newBuilder().buildMenu()

    const entry = lastMenu().get('demo (/projects/demo)')
    if (typeof entry?.click !== 'function') throw new Error('no Recent entry for demo')
    // @ts-expect-error: the menu handler ignores the item, window and event Electron passes
    entry.click()

    expect(mainWindow.webContents.send).toHaveBeenCalledWith('project:open-recent-accelerator', '/projects/demo')
    expect(mockOpenProjectByPath).not.toHaveBeenCalled()
  })
})
