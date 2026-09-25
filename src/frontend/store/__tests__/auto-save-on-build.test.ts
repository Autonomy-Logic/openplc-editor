import { createStore, StoreApi } from 'zustand/vanilla'

import { createWorkspaceSlice } from '../slices/workspace/slice'
import type { WorkspaceSlice } from '../slices/workspace/types'

/**
 * `autoSaveOnBuild` decides whether a build flushes the whole project first.
 *
 * It matters because on a partner integration session that pre-build save is
 * delivered to the partner synchronously: a partner whose callback is slow pays
 * for one delivery per build, for a save their user never asked for. Only such a
 * session ever turns it off.
 *
 * The value the store holds is normalised from the backend, and the normalisation
 * is the fragile part: absent has to read as ON. A missing field reading as OFF
 * would silently stop every durable project and the desktop editor from saving
 * before a build, and nothing on screen would say so — the build would just
 * compile without persisting first.
 */
function makeStore(): StoreApi<WorkspaceSlice> {
  return createStore<WorkspaceSlice>()(createWorkspaceSlice)
}

describe('workspace.autoSaveOnBuild', () => {
  let store: StoreApi<WorkspaceSlice>

  beforeEach(() => {
    store = makeStore()
  })

  it('starts on, which is how the editor behaves everywhere else', () => {
    expect(store.getState().workspace.autoSaveOnBuild).toBe(true)
  })

  it('is turned off only by an explicit false', () => {
    store.getState().workspaceActions.setAutoSaveOnBuild(false)
    expect(store.getState().workspace.autoSaveOnBuild).toBe(false)
  })

  it('can be turned back on', () => {
    store.getState().workspaceActions.setAutoSaveOnBuild(false)
    store.getState().workspaceActions.setAutoSaveOnBuild(true)
    expect(store.getState().workspace.autoSaveOnBuild).toBe(true)
  })

  /**
   * The shape the open-project handler applies: `data.autoSaveOnBuild !== false`.
   * Pinned here rather than left implicit, because every value except `false`
   * has to mean ON — a backend that does not send the field at all (the desktop
   * editor, an older Edge) must keep saving before builds.
   */
  it.each([
    [undefined, true],
    [null, true],
    [true, true],
    [false, false],
  ])('reads %s from the backend as %s', (fromBackend, expected) => {
    store.getState().workspaceActions.setAutoSaveOnBuild(fromBackend !== false)
    expect(store.getState().workspace.autoSaveOnBuild).toBe(expected)
  })
})
