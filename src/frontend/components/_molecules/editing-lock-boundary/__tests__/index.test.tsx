import { describe, expect, it } from '@jest/globals'
import { act, render, screen } from '@testing-library/react'

import { createStoreWrapper, createTestStore } from '../../../../store/testing'
import { EditingLockBoundary } from '../index'

function renderBoundary(store: ReturnType<typeof createTestStore>) {
  return render(
    <EditingLockBoundary>
      <button type='button'>Add</button>
    </EditingLockBoundary>,
    { wrapper: createStoreWrapper(store) },
  )
}

describe('EditingLockBoundary', () => {
  it('should render its children untouched while no debug session is open', () => {
    const store = createTestStore()

    renderBoundary(store)

    expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled()
  })

  it('should not mark itself locked while no debug session is open', () => {
    const store = createTestStore()

    const { container } = renderBoundary(store)

    expect(container.querySelector('[data-editing-locked="true"]')).toBeNull()
  })

  it('should disable its children once a debug session opens', () => {
    const store = createTestStore()
    renderBoundary(store)

    act(() => {
      store.getState().workspaceActions.setDebuggerVisible(true)
    })

    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
  })

  it('should mark itself locked once a debug session opens', () => {
    const store = createTestStore()
    const { container } = renderBoundary(store)

    act(() => {
      store.getState().workspaceActions.setDebuggerVisible(true)
    })

    expect(container.querySelector('[data-editing-locked="true"]')).not.toBeNull()
  })

  it('should lock through a disabled fieldset, not through inert', () => {
    const store = createTestStore()
    const { container } = renderBoundary(store)

    act(() => {
      store.getState().workspaceActions.setDebuggerVisible(true)
    })

    const fieldset = container.querySelector('fieldset')
    expect(fieldset).not.toBeNull()
    expect(fieldset?.hasAttribute('disabled')).toBe(true)
    expect(fieldset?.hasAttribute('inert')).toBe(false)
  })

  it('should keep pointer events so the not-allowed cursor shows', () => {
    const store = createTestStore()
    const { container } = renderBoundary(store)

    act(() => {
      store.getState().workspaceActions.setDebuggerVisible(true)
    })

    expect(container.querySelector('.pointer-events-none')).toBeNull()
  })

  it('should release its children when the debug session closes', () => {
    const store = createTestStore()
    const { container } = renderBoundary(store)

    act(() => {
      store.getState().workspaceActions.setDebuggerVisible(true)
    })
    act(() => {
      store.getState().workspaceActions.clearDebugState()
    })

    expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled()
    expect(container.querySelector('[data-editing-locked="true"]')).toBeNull()
  })
})
