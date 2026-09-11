/**
 * What the version-control and cloud-save channels refuse.
 *
 * The renderer is not a trusted caller. Every optional argument here means something
 * specific when it is absent — `files: undefined` means "all files" to `createCommit`
 * and `createStash`, and an omitted `pouFiles` means "delete every POU" to a backend
 * that deletes by omission. So a malformed argument has to be REFUSED, never dropped:
 * dropping it turns a renderer bug into a destructive operation the user did not ask
 * for, and nothing on screen would say so.
 */

import { createCommit, createStash, discardChanges } from '@root/backend/editor/edge-version-control'
import { saveCloudProject } from '@root/backend/editor/edge-projects'
import type { WriteProjectFiles } from '@root/middleware/shared/ports/project-port'

import MainProcessBridge from '../main'

jest.mock('electron', () => ({
  app: { getPath: jest.fn(() => '/tmp') },
  dialog: {},
  nativeTheme: { shouldUseDarkColors: false, themeSource: 'system' },
  shell: { openExternal: jest.fn() },
}))

jest.mock('@root/backend/editor/edge-version-control', () => ({
  createCommit: jest.fn(),
  createStash: jest.fn(),
  discardChanges: jest.fn(),
}))

jest.mock('@root/backend/editor/edge-projects', () => ({
  saveCloudProject: jest.fn(),
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

const commit = jest.mocked(createCommit)
const stash = jest.mocked(createStash)
const discard = jest.mocked(discardChanges)
const save = jest.mocked(saveCloudProject)

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

/** The IpcMainInvokeEvent the handlers ignore. */
const EVENT = {} as never

const BAD_REQUEST = { ok: false, failure: { kind: 'http', status: 400 } }

/** A payload the save channel should accept, so the refusals below mean something. */
const VALID_SAVE: WriteProjectFiles = {
  projectPath: 'cloud-project-id',
  projectJson: '{}',
  pouFiles: [{ relativePath: 'pous/programs/main.st', content: 'x;' }],
  serverFiles: [],
  remoteDeviceFiles: [],
  dataTypeFiles: [],
  deletions: [],
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('a malformed file selection', () => {
  it.each([
    ['commit', (files: unknown) => bridge.handleEdgeVcCreateCommit(EVENT, 'p1', 'a message', files, undefined)],
    ['stash', (files: unknown) => bridge.handleEdgeVcCreateStash(EVENT, 'p1', 'a message', files)],
    ['discard', (files: unknown) => bridge.handleEdgeVcDiscardChanges(EVENT, 'p1', files)],
  ])('is refused by %s rather than read as "every file"', async (_label, invoke) => {
    // One non-string entry. `vcStringArray` answers undefined for a partially valid
    // list, and undefined means "all files" downstream — so forwarding it would commit,
    // stash or discard the WHOLE project when the user ticked three files.
    await expect(invoke(['pous/programs/main.st', 42])).resolves.toMatchObject(BAD_REQUEST)

    expect(commit).not.toHaveBeenCalled()
    expect(stash).not.toHaveBeenCalled()
    expect(discard).not.toHaveBeenCalled()
  })

  it.each([
    ['commit', () => bridge.handleEdgeVcCreateCommit(EVENT, 'p1', 'a message', undefined, undefined), commit],
    ['stash', () => bridge.handleEdgeVcCreateStash(EVENT, 'p1', 'a message', undefined), stash],
    ['discard', () => bridge.handleEdgeVcDiscardChanges(EVENT, 'p1', undefined), discard],
  ])('is not what an ABSENT selection is: %s still means every file', async (_label, invoke, target) => {
    await invoke()

    expect(target).toHaveBeenCalled()
  })
})

describe('the cloud save channel', () => {
  it('refuses a payload that is not a complete set of project files', async () => {
    // `projectPath` alone used to be the whole check, with the rest declared rather
    // than validated. The payload becomes an envelope posted to Edge, and the backend
    // deletes by omission: a missing `pouFiles` asks it to delete every POU.
    await expect(bridge.handleEdgeProjectsSaveProject(EVENT, { projectPath: 'p1' })).resolves.toMatchObject({
      success: false,
    })

    expect(save).not.toHaveBeenCalled()
  })

  it.each([
    ['no payload at all', undefined],
    ['an empty project id', { ...VALID_SAVE, projectPath: '' }],
    ['a POU entry that is not a file', { ...VALID_SAVE, pouFiles: [{ relativePath: 'a.st' }] }],
  ])('refuses %s', async (_label, payload) => {
    await expect(bridge.handleEdgeProjectsSaveProject(EVENT, payload)).resolves.toMatchObject({ success: false })

    expect(save).not.toHaveBeenCalled()
  })

  it('forwards a complete payload untouched', async () => {
    await bridge.handleEdgeProjectsSaveProject(EVENT, VALID_SAVE)

    expect(save).toHaveBeenCalledWith(VALID_SAVE)
  })
})
