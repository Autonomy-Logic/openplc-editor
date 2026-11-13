/**
 * The native Edit and File items that change the project are disabled while a debug
 * session is open. A disabled item's accelerator does not fire either, so this is what
 * keeps their shortcuts off on macOS and Linux, where the native menu is the only one.
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

/** The native menu items the lock disables. */
const EDITING_ITEMS = [
  'menu:edit.submenu.undo',
  'menu:edit.submenu.redo',
  'menu:edit.submenu.deletePou',
  'menu:file.submenu.importFromPLCOpenXml',
]

describe.each(['darwin', 'linux'] as const)('%s native menu during a debug session', (platform) => {
  beforeEach(() => setPlatform(platform))

  it('offers the editing items with a project open and no debug session (TC20)', async () => {
    const builder = newBuilder()
    await builder.buildMenu()
    await builder.setProjectOpen(true)

    const menu = lastMenu()
    for (const label of EDITING_ITEMS) expect([label, menu.get(label)?.enabled]).toEqual([label, true])
  })

  it('disables the editing items while the debugger is open (TC19)', async () => {
    const builder = newBuilder()
    await builder.buildMenu()
    await builder.setProjectOpen(true)

    await builder.setDebuggerActive(true)

    const menu = lastMenu()
    for (const label of EDITING_ITEMS) expect([label, menu.get(label)?.enabled]).toEqual([label, false])
  })

  it('offers them again once the debugger closes (TC20)', async () => {
    const builder = newBuilder()
    await builder.buildMenu()
    await builder.setProjectOpen(true)

    await builder.setDebuggerActive(true)
    await builder.setDebuggerActive(false)

    const menu = lastMenu()
    for (const label of EDITING_ITEMS) expect([label, menu.get(label)?.enabled]).toEqual([label, true])
  })

  it('rebuilds the menu only when the debug state really changes', async () => {
    const builder = newBuilder()
    await builder.buildMenu()
    await builder.setProjectOpen(true)
    const before = Menu.setApplicationMenu.mock.calls.length

    await builder.setDebuggerActive(false)

    expect(Menu.setApplicationMenu.mock.calls.length).toBe(before)
  })

  it('leaves the items that need no project alone while the debugger is open', async () => {
    const builder = newBuilder()
    await builder.buildMenu()
    await builder.setProjectOpen(true)

    await builder.setDebuggerActive(true)

    const menu = lastMenu()
    expect(menu.get('menu:file.submenu.newProject')?.enabled).not.toBe(false)
    expect(menu.get('menu:edit.submenu.copy')?.enabled).not.toBe(false)
  })
})

describe('with no project open the native items keep their current state (TC77)', () => {
  it('keeps the system undo and redo roles on macOS', async () => {
    setPlatform('darwin')
    const builder = newBuilder()
    await builder.buildMenu()

    await builder.setDebuggerActive(true)

    const menu = lastMenu()
    expect(menu.get('menu:edit.submenu.undo')?.role).toBe('undo')
    expect(menu.get('menu:edit.submenu.redo')?.role).toBe('redo')
    expect(menu.get('menu:edit.submenu.deletePou')?.enabled).toBe(false)
    expect(menu.get('menu:file.submenu.importFromPLCOpenXml')?.enabled).toBe(false)
  })

  it('keeps the four items disabled on Linux', async () => {
    setPlatform('linux')
    const builder = newBuilder()
    await builder.buildMenu()

    await builder.setDebuggerActive(true)

    const menu = lastMenu()
    for (const label of EDITING_ITEMS) expect([label, menu.get(label)?.enabled]).toEqual([label, false])
  })
})
