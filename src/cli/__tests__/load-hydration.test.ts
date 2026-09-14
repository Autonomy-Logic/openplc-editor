/**
 * `loadProject` hydrates the library pool, and does it FIRST.
 *
 * `handleOpenProjectResponse` reads `libraries.system` and re-stamps every
 * placed block against it inside the same action, and `setProjectLibraries`
 * derives the enabled/missing lists from it. A pool hydrated afterwards is a
 * pool neither of them saw.
 *
 * Ordering is the whole assertion. `jest-vi-shim.ts` already hydrates system
 * libraries for every spec in this repo, so a test that merely checks the pool
 * is populated passes whether or not `loadProject` does anything at all. The
 * store is mocked rather than spied on because its real state is immer-frozen
 * and cannot be instrumented in place.
 */

import { loadProject } from '../project/load'

const archives = [{ manifest: { name: 'demo', version: '1.0.0' } }]

/** Call order, in the order `loadProject` drives the store. */
const calls: string[] = []
const record =
  (name: string) =>
  (...args: unknown[]) => {
    calls.push(name)
    return args
  }

let setSystemLibraries: jest.Mock
let setBundledLibraryNames: jest.Mock
let canEdit = true
let isEphemeralProject = false

jest.mock('@root/frontend/store', () => ({
  openPLCStoreBase: {
    getState: () => ({
      deviceActions: { setAvailableOptions: record('setAvailableOptions') },
      libraryActions: {
        setSystemLibraries,
        setBundledLibraryNames,
      },
      sharedWorkspaceActions: { handleOpenProjectResponse: record('handleOpenProjectResponse') },
      project: { meta: { name: 'demo' }, data: {} },
      projectActions: { getCompileReadyProjectData: () => ({}) },
      workspace: { canEdit, isEphemeralProject },
      deviceDefinitions: {
        configuration: { deviceBoard: 'Uno', vendorScreenData: undefined, communicationPort: undefined },
      },
    }),
  },
}))

jest.mock('@root/backend/editor/hardware', () => ({
  HardwareModule: jest.fn().mockImplementation(() => ({ getAvailableBoards: async () => [] })),
}))

jest.mock('@root/backend/editor/services', () => ({
  ProjectService: jest.fn().mockImplementation(() => ({
    readRawProjectFiles: async () => ({
      success: true,
      data: { projectPath: '/tmp/p', projectJson: {}, pouFiles: [], dataTypeFiles: [] },
    }),
  })),
}))

jest.mock('@root/backend/shared/utils/parse-project-files', () => ({
  parseProjectFiles: () => ({ warnings: ['a parse warning'] }),
}))

jest.mock('@root/backend/editor/library-manager', () => ({
  LibraryManagerModule: jest.fn().mockImplementation(() => ({
    loadAll: () => archives,
    listInstalled: () => [
      { name: 'bundled-one', bundled: true },
      { name: 'user-one', bundled: false },
    ],
  })),
}))

jest.mock('@root/frontend/utils/stlib-to-system-library', () => ({
  stlibsToSystemLibraries: (input: unknown) => input,
}))

beforeEach(() => {
  calls.length = 0
  canEdit = true
  isEphemeralProject = false
  setSystemLibraries = jest.fn(record('setSystemLibraries'))
  setBundledLibraryNames = jest.fn(record('setBundledLibraryNames'))
})

describe('loadProject library hydration', () => {
  it('sets the system libraries before opening the project', async () => {
    await loadProject('/tmp/p')

    expect(calls).toEqual([
      'setAvailableOptions',
      'setSystemLibraries',
      'setBundledLibraryNames',
      'handleOpenProjectResponse',
    ])
  })

  it('passes the installed archives through, and names only the bundled ones', async () => {
    await loadProject('/tmp/p')

    expect(setSystemLibraries).toHaveBeenCalledWith(archives)
    expect(setBundledLibraryNames).toHaveBeenCalledWith(['bundled-one'])
  })

  it('warns rather than failing the load when the library store cannot be read', async () => {
    setSystemLibraries = jest.fn(() => {
      throw new Error('registry unreadable')
    })

    const result = await loadProject('/tmp/p')

    expect(result.success).toBe(true)
    expect(result.success && result.project.warnings).toEqual([
      'warning: could not read the installed libraries: registry unreadable',
      'a parse warning',
    ])
  })
})

describe('loadProject save guards', () => {
  // `executeSaveProject` refuses on either of these and reports only through a
  // toast, so a writing command that does not check them exits 0 having written
  // nothing.
  it('reports the workspace flags a writing command has to check', async () => {
    const result = await loadProject('/tmp/p')

    expect(result.success && result.project.canEdit).toBe(true)
    expect(result.success && result.project.isEphemeral).toBe(false)
  })

  it('carries a read-only workspace through rather than hiding it', async () => {
    canEdit = false
    isEphemeralProject = true

    const result = await loadProject('/tmp/p')

    expect(result.success && result.project.canEdit).toBe(false)
    expect(result.success && result.project.isEphemeral).toBe(true)
  })
})
