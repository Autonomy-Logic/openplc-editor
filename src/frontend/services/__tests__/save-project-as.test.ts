/**
 * Giving a project a new home.
 *
 * The ordering is the substance here. A project retrieved from a device refuses
 * a user save and points at Save As, so Save As is the only way out for it --
 * which means a failed one must leave that refusal intact. Adopting the
 * destination before the write succeeds would clear the very marker protecting
 * the project, and leave it pointing at a directory that does not contain it.
 */

import type { PlatformCapabilities } from '../../../middleware/shared/ports/platform-capabilities'
import type { ProjectPort } from '../../../middleware/shared/ports/project-port'
import { openPLCStoreBase } from '../../store'
import { executeSaveProjectAs } from '../save-project-as'

const capabilities = { isNativeApplication: true } as PlatformCapabilities

function makePort(overrides: Partial<ProjectPort> = {}): ProjectPort {
  return {
    pickPath: () => Promise.resolve({ success: true, path: '/chosen/place' }),
    saveProject: () => Promise.resolve({ success: true }),
    ...overrides,
  } as unknown as ProjectPort
}

const workspace = () => openPLCStoreBase.getState().workspace
const projectPath = () => openPLCStoreBase.getState().project.meta.path

beforeEach(() => {
  openPLCStoreBase.getState().workspaceActions.setIsEphemeralProject(true)
  openPLCStoreBase.getState().projectActions.updateMetaPath('/scratch/original')
})

afterEach(() => {
  openPLCStoreBase.getState().workspaceActions.setIsEphemeralProject(false)
})

it('writes the project to the chosen folder and adopts it', async () => {
  let written: { projectPath?: string } | undefined
  const port = makePort({
    saveProject: (files) => {
      written = files
      return Promise.resolve({ success: true })
    },
  })

  const result = await executeSaveProjectAs(port, capabilities)

  expect(result.success).toBe(true)
  expect(written?.projectPath).toBe('/chosen/place')
  expect(projectPath()).toBe('/chosen/place')
})

it('clears the ephemeral marker so an ordinary save works from then on', async () => {
  // The whole reason Save As exists for a retrieved project.
  await executeSaveProjectAs(makePort(), capabilities)
  expect(workspace().isEphemeralProject).toBe(false)
})

it('leaves everything untouched when the write fails', async () => {
  // Adopting the destination first would point the project at a folder that
  // does not contain it, and would drop the refusal that is protecting it.
  const port = makePort({
    saveProject: () => Promise.resolve({ success: false, error: 'disk full' }),
  })

  const result = await executeSaveProjectAs(port, capabilities)

  expect(result.success).toBe(false)
  expect(projectPath()).toBe('/scratch/original')
  expect(workspace().isEphemeralProject).toBe(true)
})

it('treats cancelling as an ordinary outcome, not a failure', async () => {
  const port = makePort({ pickPath: () => Promise.resolve({ success: false }) })

  const result = await executeSaveProjectAs(port, capabilities)

  expect(result.cancelled).toBe(true)
  expect(projectPath()).toBe('/scratch/original')
  expect(workspace().isEphemeralProject).toBe(true)
})

it('never carries deletions to the new location', async () => {
  // The destination is fresh. A deletion list from the old location would
  // remove files there that were never copied.
  let written: { deletions?: string[] } | undefined
  const port = makePort({
    saveProject: (files) => {
      written = files
      return Promise.resolve({ success: true })
    },
  })

  await executeSaveProjectAs(port, capabilities)

  expect(written?.deletions).toEqual([])
})

it('reports platforms that cannot choose a folder rather than failing silently', async () => {
  const port = makePort({ pickPath: undefined })
  const result = await executeSaveProjectAs(port, capabilities)
  expect(result.success).toBe(false)
  expect(workspace().isEphemeralProject).toBe(true)
})
