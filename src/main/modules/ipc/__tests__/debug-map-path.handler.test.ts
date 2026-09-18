/**
 * The debug map is read from wherever the build wrote it.
 *
 * A cloud project is an Edge id, so `path.resolve(projectPath, 'build', …)`
 * resolved against `process.cwd()` while the build had already been redirected
 * to the scratch workspace. Compilation succeeded and then the debugger failed
 * on a file that was never going to be at that path.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

let userData: string

jest.mock('electron', () => ({
  app: { getPath: jest.fn(() => userData) },
  dialog: {},
  nativeTheme: { shouldUseDarkColors: false, themeSource: 'system' },
  shell: { openExternal: jest.fn() },
}))

jest.mock('@root/backend/editor/ethercat', () => ({ ESIService: jest.fn() }))
jest.mock('@root/backend/editor/library-manager/desktop-catalog-transport', () => ({
  createDesktopCatalogTransport: jest.fn(() => ({})),
}))
jest.mock('@root/backend/editor/utils/runtime-https-config', () => ({ getRuntimeHttpsOptions: jest.fn(() => ({})) }))
jest.mock('@root/backend/shared/ethercat/esi-parser-main', () => ({ parseESIDeviceFull: jest.fn() }))
jest.mock('@root/backend/shared/library/public-catalog-client', () => ({ listPublicLibraries: jest.fn() }))
jest.mock('../../../../backend/editor/library-manager', () => ({
  LibraryManagerModule: jest.fn(() => ({ loadEnabledArchives: jest.fn(() => ({ archives: [], missing: [] })) })),
}))
jest.mock('../../../../backend/editor/package-manager', () => ({ PackageManagerModule: jest.fn(() => ({})) }))
jest.mock('../../../../backend/editor/services', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))
jest.mock('../../../../backend/editor/utils', () => ({
  getOpenProjectPath: jest.fn(),
  getProjectPath: jest.fn(),
}))
jest.mock('../../../../backend/shared/simulator/simulator-module', () => ({
  SimulatorModule: jest.fn(() => ({ stop: jest.fn() })),
}))

import { cloudBuildRoot } from '@root/backend/editor/project/cloud-build-workspace'

import MainProcessBridge from '../main'

const bridge = new MainProcessBridge({
  ipcMain: {},
  mainWindow: { isDestroyed: jest.fn(() => false), isMaximized: jest.fn(() => false) },
  projectService: {},
  store: { get: jest.fn(() => undefined) },
  menuBuilder: {},
  pouService: {},
  compilerModule: {},
  hardwareModule: {},
} as never)

const EVENT = {} as never
const BOARD = 'OpenPLC Simulator'
const CLOUD_ID = 'cmu37i2a503br06juf5gim9ub'
const MAP = JSON.stringify({ md5: 'a'.repeat(32) })

/** Write a debug map into the build tree rooted at `root`. */
function writeDebugMap(root: string, content: string): void {
  const dir = join(root, 'build', BOARD, 'src')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'debug-map.json'), content)
}

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'openplc-userdata-'))
})

afterEach(() => {
  rmSync(userData, { recursive: true, force: true })
})

describe('a cloud project', () => {
  it('reads the debug map the build wrote into the scratch workspace', async () => {
    writeDebugMap(join(cloudBuildRoot(), CLOUD_ID), MAP)

    await expect(bridge.handleReadDebugFile(EVENT, CLOUD_ID, BOARD)).resolves.toEqual({
      success: true,
      content: MAP,
    })
  })

  it('reads the MD5 from that same copy', async () => {
    writeDebugMap(join(cloudBuildRoot(), CLOUD_ID), MAP)

    await expect(bridge.handleReadProgramStMd5(EVENT, CLOUD_ID, BOARD)).resolves.toEqual({
      success: true,
      md5: 'a'.repeat(32),
    })
  })
})

describe('a project on disk', () => {
  it('still reads the map next to its own sources', async () => {
    const local = mkdtempSync(join(tmpdir(), 'openplc-local-'))
    writeDebugMap(local, MAP)

    try {
      await expect(bridge.handleReadDebugFile(EVENT, local, BOARD)).resolves.toEqual({
        success: true,
        content: MAP,
      })
    } finally {
      rmSync(local, { recursive: true, force: true })
    }
  })
})

describe('the board target', () => {
  it.each(['/absolute', '..', 'nested/target'])('is refused when it is %p', async (board) => {
    await expect(bridge.handleReadDebugFile(EVENT, CLOUD_ID, board)).resolves.toEqual({
      success: false,
      error: 'Invalid board target',
    })
  })
})
