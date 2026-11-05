/**
 * The Persistent Storage screen owns no control a debug session keeps
 * available, so the editor host locks it whole through EditingLockBoundary.
 */
import { EditingLockBoundary } from '@root/frontend/components/_molecules/editing-lock-boundary'
import type { OpenPLCStore } from '@root/frontend/store'
import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import { act, render, screen } from '@testing-library/react'

import { PersistentStorageEditor } from '../index'

let store: OpenPLCStore

const renderHosted = () =>
  render(
    <EditingLockBoundary>
      <PersistentStorageEditor />
    </EditingLockBoundary>,
    { wrapper: createStoreWrapper(store) },
  )

const openDebugSession = () =>
  act(() => {
    store.getState().workspaceActions.setDebuggerVisible(true)
  })

const keepOnDevice = () => screen.getByLabelText('Keep retained variables on the device')

describe('Persistent Storage during a debug session', () => {
  beforeEach(() => {
    store = createTestStore()
  })

  it('should accept edits while no debug session is open', () => {
    renderHosted()

    expect(keepOnDevice().matches(':disabled')).toBe(false)
  })

  it('should refuse edits while a debug session is open', () => {
    renderHosted()

    openDebugSession()

    expect(keepOnDevice().matches(':disabled')).toBe(true)
  })

  it('should lock every control of the screen, not only the first', () => {
    renderHosted()

    openDebugSession()

    const controls = screen.getAllByRole('textbox').concat(screen.getAllByRole('checkbox'))
    expect(controls.length).toBeGreaterThan(0)
    for (const control of controls) {
      expect(control.matches(':disabled')).toBe(true)
    }
  })

  it('should accept edits again once the debug session closes', () => {
    renderHosted()

    openDebugSession()
    act(() => {
      store.getState().workspaceActions.clearDebugState()
    })

    expect(keepOnDevice().matches(':disabled')).toBe(false)
  })
})
