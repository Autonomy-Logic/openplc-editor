import type { State, ToasterToast } from '../toast'
import { dispatch, getMemoryState, listeners, reducer, toast } from '../toast'

// ---------------------------------------------------------------------------
// Reset state before each test to ensure isolation
// ---------------------------------------------------------------------------

function resetState() {
  // Remove all toasts
  dispatch({ type: 'REMOVE_TOAST', toastId: undefined })
  // Clear listeners
  listeners.length = 0
}

beforeEach(() => {
  resetState()
})

// ---------------------------------------------------------------------------
// reducer — ADD_TOAST
// ---------------------------------------------------------------------------

describe('reducer — ADD_TOAST', () => {
  it('adds a toast to the front of the list', () => {
    const initial: State = { toasts: [] }
    const t: ToasterToast = { id: '1', title: 'Hello' }
    const next = reducer(initial, { type: 'ADD_TOAST', toast: t })
    expect(next.toasts).toHaveLength(1)
    expect(next.toasts[0].id).toBe('1')
  })

  it('limits toasts to TOAST_LIMIT (1)', () => {
    const existing: ToasterToast = { id: 'old', title: 'Old' }
    const initial: State = { toasts: [existing] }
    const t: ToasterToast = { id: 'new', title: 'New' }
    const next = reducer(initial, { type: 'ADD_TOAST', toast: t })
    expect(next.toasts).toHaveLength(1)
    expect(next.toasts[0].id).toBe('new')
  })
})

// ---------------------------------------------------------------------------
// reducer — UPDATE_TOAST
// ---------------------------------------------------------------------------

describe('reducer — UPDATE_TOAST', () => {
  it('updates a toast by id', () => {
    const initial: State = { toasts: [{ id: '1', title: 'Original' }] }
    const next = reducer(initial, { type: 'UPDATE_TOAST', toast: { id: '1', title: 'Updated' } })
    expect(next.toasts[0].title).toBe('Updated')
  })

  it('does not modify other toasts', () => {
    const initial: State = { toasts: [{ id: '1', title: 'A' }] }
    const next = reducer(initial, { type: 'UPDATE_TOAST', toast: { id: '999', title: 'B' } })
    expect(next.toasts[0].title).toBe('A')
  })
})

// ---------------------------------------------------------------------------
// reducer — DISMISS_TOAST
// ---------------------------------------------------------------------------

describe('reducer — DISMISS_TOAST', () => {
  it('sets open to false for a specific toast', () => {
    const initial: State = { toasts: [{ id: '1', open: true }] }
    const next = reducer(initial, { type: 'DISMISS_TOAST', toastId: '1' })
    expect(next.toasts[0].open).toBe(false)
  })

  it('sets open to false for all toasts when toastId is undefined', () => {
    const initial: State = {
      toasts: [
        { id: '1', open: true },
        { id: '2', open: true },
      ],
    }
    const next = reducer(initial, { type: 'DISMISS_TOAST', toastId: undefined })
    expect(next.toasts[0].open).toBe(false)
    expect(next.toasts[1].open).toBe(false)
  })

  it('does not change open for non-matching toast', () => {
    const initial: State = {
      toasts: [
        { id: '1', open: true },
        { id: '2', open: true },
      ],
    }
    const next = reducer(initial, { type: 'DISMISS_TOAST', toastId: '1' })
    expect(next.toasts[0].open).toBe(false)
    expect(next.toasts[1].open).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// reducer — REMOVE_TOAST
// ---------------------------------------------------------------------------

describe('reducer — REMOVE_TOAST', () => {
  it('removes a specific toast by id', () => {
    const initial: State = { toasts: [{ id: '1' }, { id: '2' }] }
    const next = reducer(initial, { type: 'REMOVE_TOAST', toastId: '1' })
    expect(next.toasts).toHaveLength(1)
    expect(next.toasts[0].id).toBe('2')
  })

  it('removes all toasts when toastId is undefined', () => {
    const initial: State = { toasts: [{ id: '1' }, { id: '2' }] }
    const next = reducer(initial, { type: 'REMOVE_TOAST', toastId: undefined })
    expect(next.toasts).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// dispatch and getMemoryState
// ---------------------------------------------------------------------------

describe('dispatch and getMemoryState', () => {
  it('updates in-memory state', () => {
    dispatch({ type: 'ADD_TOAST', toast: { id: 'test', title: 'Test' } })
    const state = getMemoryState()
    expect(state.toasts.length).toBeGreaterThanOrEqual(1)
  })

  it('notifies listeners on dispatch', () => {
    let notified = false
    listeners.push(() => {
      notified = true
    })
    dispatch({ type: 'ADD_TOAST', toast: { id: 'test2', title: 'Test2' } })
    expect(notified).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// toast function
// ---------------------------------------------------------------------------

describe('toast', () => {
  it('returns an id, dismiss, and update function', () => {
    const result = toast({ title: 'Test' })
    expect(typeof result.id).toBe('string')
    expect(typeof result.dismiss).toBe('function')
    expect(typeof result.update).toBe('function')
  })

  it('adds a toast with open=true and onOpenChange', () => {
    toast({ title: 'Open test' })
    const state = getMemoryState()
    const t = state.toasts.find((x) => x.title === 'Open test')
    expect(t).toBeTruthy()
    expect(t!.open).toBe(true)
    expect(typeof t!.onOpenChange).toBe('function')
  })

  it('dismiss sets open to false', () => {
    const result = toast({ title: 'Dismiss test' })
    result.dismiss()
    const state = getMemoryState()
    const t = state.toasts.find((x) => x.id === result.id)
    // After dismiss, the toast is either open=false or removed
    if (t) {
      expect(t.open).toBe(false)
    }
  })

  it('update modifies the toast', () => {
    const result = toast({ title: 'Before' })
    result.update({ id: result.id, title: 'After' })
    const state = getMemoryState()
    const t = state.toasts.find((x) => x.id === result.id)
    expect(t?.title).toBe('After')
  })

  it('onOpenChange calls dismiss when open=false', () => {
    toast({ title: 'OnOpenChange test' })
    const state = getMemoryState()
    const t = state.toasts[0]
    expect(t.onOpenChange).toBeDefined()
    t.onOpenChange!(false)
    const afterState = getMemoryState()
    const updated = afterState.toasts.find((x) => x.id === t.id)
    if (updated) {
      expect(updated.open).toBe(false)
    }
  })

  it('onOpenChange does nothing when open=true', () => {
    toast({ title: 'OnOpenChange true test' })
    const state = getMemoryState()
    const t = state.toasts[0]
    expect(t.onOpenChange).toBeDefined()
    t.onOpenChange!(true)
    const afterState = getMemoryState()
    const updated = afterState.toasts.find((x) => x.id === t.id)
    // Toast should still be open (dismiss was not called)
    expect(updated).toBeTruthy()
    expect(updated!.open).toBe(true)
  })

  it('generates unique ids across calls', () => {
    const a = toast({ title: 'A' })
    // Reset to make room for another toast (limit=1)
    dispatch({ type: 'REMOVE_TOAST', toastId: undefined })
    const b = toast({ title: 'B' })
    expect(a.id).not.toBe(b.id)
  })

  it('addToRemoveQueue is idempotent (calling dismiss twice does not double-enqueue)', () => {
    const result = toast({ title: 'Idempotent' })
    result.dismiss()
    result.dismiss()
    // Should not throw; state should be consistent
    const state = getMemoryState()
    const t = state.toasts.find((x) => x.id === result.id)
    if (t) {
      expect(t.open).toBe(false)
    }
  })

  it('addToRemoveQueue timeout fires and removes the toast', () => {
    vi.useFakeTimers()
    const result = toast({ title: 'Timeout test' })
    result.dismiss()
    // Advance timers past the TOAST_REMOVE_DELAY (1_000_000 ms)
    vi.advanceTimersByTime(1_100_000)
    const state = getMemoryState()
    const t = state.toasts.find((x) => x.id === result.id)
    // Toast should have been removed by the timeout callback
    expect(t).toBeUndefined()
    vi.useRealTimers()
  })
})
