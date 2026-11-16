import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import { act, render, screen } from '@testing-library/react'

import type { OpenPLCStore } from '@root/frontend/store'

import { HostLockBoundary } from '../index'

let store: OpenPLCStore

const renderWith = (type: Parameters<typeof HostLockBoundary>[0]['type']) => {
  store = createTestStore()
  render(
    <HostLockBoundary type={type}>
      <button type='button'>Save</button>
    </HostLockBoundary>,
    { wrapper: createStoreWrapper(store) },
  )
  act(() => {
    store.getState().workspaceActions.setDebuggerVisible(true)
  })
  return screen.getByRole('button', { name: 'Save' })
}

describe('the host lock boundary', () => {
  it('should lock an editor the policy marks host-locked', () => {
    expect(renderWith('plc-persistent-storage').matches(':disabled')).toBe(true)
  })

  it('should leave a self-locked editor to lock its own controls', () => {
    expect(renderWith('plc-library-manager').matches(':disabled')).toBe(false)
  })

  it('should leave a read-only editor untouched', () => {
    expect(renderWith('plc-diagnostics').matches(':disabled')).toBe(false)
  })
})
