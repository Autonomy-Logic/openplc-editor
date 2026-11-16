import { beforeEach, describe, expect, it } from '@jest/globals'
import { enableMapSet } from 'immer'
import { createStore } from 'zustand/vanilla'

import { selectIsEditingLocked } from '../slices/workspace/selectors'
import { createWorkspaceSlice } from '../slices/workspace/slice'
import type { WorkspaceSlice } from '../slices/workspace/types'

enableMapSet()

function makeStore() {
  return createStore<WorkspaceSlice>()(createWorkspaceSlice)
}

describe('selectIsEditingLocked', () => {
  let store: ReturnType<typeof makeStore>

  beforeEach(() => {
    store = makeStore()
  })

  it('should be false on a fresh store', () => {
    expect(selectIsEditingLocked(store.getState())).toBe(false)
  })

  it('should be true while the debugger is visible', () => {
    store.getState().workspaceActions.setDebuggerVisible(true)

    expect(selectIsEditingLocked(store.getState())).toBe(true)
  })

  it('should be false again once the debugger is hidden', () => {
    store.getState().workspaceActions.setDebuggerVisible(true)
    store.getState().workspaceActions.setDebuggerVisible(false)

    expect(selectIsEditingLocked(store.getState())).toBe(false)
  })

  it('should be false again once the debug state is cleared', () => {
    store.getState().workspaceActions.setDebuggerVisible(true)
    store.getState().workspaceActions.clearDebugState()

    expect(selectIsEditingLocked(store.getState())).toBe(false)
  })

  it('should not be driven by canEdit when the debugger is closed', () => {
    store.getState().workspaceActions.setCanEdit(false)

    expect(selectIsEditingLocked(store.getState())).toBe(false)
  })

  it('should stay locked while the debugger is visible even when canEdit is true', () => {
    store.getState().workspaceActions.setCanEdit(true)
    store.getState().workspaceActions.setDebuggerVisible(true)

    expect(selectIsEditingLocked(store.getState())).toBe(true)
  })

  it('should not change when unrelated debug state moves', () => {
    store.getState().workspaceActions.setDebuggerVisible(true)
    const before = selectIsEditingLocked(store.getState())

    store.getState().workspaceActions.setDebugTick(7)
    store.getState().workspaceActions.setDebuggerTargetIp('192.168.0.10')

    expect(selectIsEditingLocked(store.getState())).toBe(before)
  })
})
