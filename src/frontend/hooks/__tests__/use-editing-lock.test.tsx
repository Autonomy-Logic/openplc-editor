import { afterEach, beforeEach, describe, expect, it } from '@jest/globals'
import { act, renderHook } from '@testing-library/react'

import { createStoreWrapper, createTestStore } from '../../store/testing'
import { useIsEditingLocked } from '../use-editing-lock'

describe('useIsEditingLocked', () => {
  let store: ReturnType<typeof createTestStore>

  beforeEach(() => {
    store = createTestStore()
  })

  afterEach(() => {
    act(() => {
      store.getState().workspaceActions.clearDebugState()
    })
  })

  it('should report false while no debug session is open', () => {
    const { result } = renderHook(() => useIsEditingLocked(), { wrapper: createStoreWrapper(store) })

    expect(result.current).toBe(false)
  })

  it('should report true once a debug session opens', () => {
    const { result } = renderHook(() => useIsEditingLocked(), { wrapper: createStoreWrapper(store) })

    act(() => {
      store.getState().workspaceActions.setDebuggerVisible(true)
    })

    expect(result.current).toBe(true)
  })

  it('should report false once the debug session closes', () => {
    const { result } = renderHook(() => useIsEditingLocked(), { wrapper: createStoreWrapper(store) })

    act(() => {
      store.getState().workspaceActions.setDebuggerVisible(true)
    })
    act(() => {
      store.getState().workspaceActions.clearDebugState()
    })

    expect(result.current).toBe(false)
  })

  it('should not follow canEdit', () => {
    const { result } = renderHook(() => useIsEditingLocked(), { wrapper: createStoreWrapper(store) })

    act(() => {
      store.getState().workspaceActions.setCanEdit(false)
    })

    expect(result.current).toBe(false)
  })

  it('should not re-render while debug values are polled', () => {
    let renders = 0
    renderHook(
      () => {
        renders += 1
        return useIsEditingLocked()
      },
      { wrapper: createStoreWrapper(store) },
    )

    act(() => {
      store.getState().workspaceActions.setDebuggerVisible(true)
    })
    const afterOpen = renders

    act(() => {
      store.getState().workspaceActions.setDebugValues({ boolValues: new Map([['a', '1']]) })
    })
    act(() => {
      store.getState().workspaceActions.setDebugTick(1)
    })
    act(() => {
      store.getState().workspaceActions.setDebugValues({ boolValues: new Map([['a', '0']]) })
    })
    act(() => {
      store.getState().workspaceActions.setDebugTick(2)
    })

    expect(renders).toBe(afterOpen)
  })
})
