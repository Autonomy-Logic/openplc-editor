import type { OpenPLCStore } from '@root/frontend/store'
import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import { cleanup, render, screen } from '@testing-library/react'

import { PlcLogs } from '..'

let store: OpenPLCStore

beforeEach(() => {
  store = createTestStore()
})

afterEach(() => {
  cleanup()
})

describe('PLC logs panel', () => {
  it('tells an operator that its role cannot read the runtime logs', () => {
    store.getState().deviceActions.setRuntimeAccountRole('operator')
    render(<PlcLogs />, { wrapper: createStoreWrapper(store) })
    expect(screen.getByText("Your role (operator) can't read the runtime logs.")).toBeTruthy()
  })

  it('shows no notice to an engineer', () => {
    store.getState().deviceActions.setRuntimeAccountRole('engineer')
    render(<PlcLogs />, { wrapper: createStoreWrapper(store) })
    expect(screen.queryByText(/can't read the runtime logs/)).toBeNull()
  })
})
