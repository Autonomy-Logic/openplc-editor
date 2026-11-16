import type { OpenPLCStore } from '@root/frontend/store'
import { CreateVendorScreenEditor } from '@root/frontend/store/slices/tabs/utils'
import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals'

import { VendorScreenTabs } from '../vendor-screen-tabs'

let store: OpenPLCStore

const wrappers = () => screen.getAllByText(/Screen not available/).map((notice) => notice.parentElement)

describe('vendor-screen tabs', () => {
  beforeEach(() => {
    store = createTestStore()
    store
      .getState()
      .editorActions.setEditor(CreateVendorScreenEditor('Backplane Configuration', 'Backplane Configuration'))
    store.getState().editorActions.setEditor(CreateVendorScreenEditor('I/O Mapping', 'I/O Mapping'))
  })

  afterEach(() => cleanup())

  it('keeps every open screen mounted and shows only the active one', () => {
    render(<VendorScreenTabs />, { wrapper: createStoreWrapper(store) })

    const [configurator, mapping] = wrappers()
    expect(configurator?.className).toContain('hidden')
    expect(mapping?.className).not.toContain('hidden')
  })

  it('switches tabs without remounting the screen it leaves', () => {
    render(<VendorScreenTabs />, { wrapper: createStoreWrapper(store) })
    const [configurator] = wrappers()

    act(() =>
      store
        .getState()
        .editorActions.setEditor(CreateVendorScreenEditor('Backplane Configuration', 'Backplane Configuration')),
    )

    const [after, mapping] = wrappers()
    expect(after).toBe(configurator)
    expect(after?.className).not.toContain('hidden')
    expect(mapping?.className).toContain('hidden')
  })
})
