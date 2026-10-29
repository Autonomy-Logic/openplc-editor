// jsdom computes no layout, so the cap and the scroll container are asserted through their classes.

import { fireEvent, render as rtlRender, screen } from '@testing-library/react'
import type { ReactElement } from 'react'

vi.mock('@root/frontend/components/_organisms/variables-code-editor', () => ({
  VariablesCodeEditor: () => <div data-testid='variables-code-editor' />,
}))

import { DTBaseTypeContainer } from '../../../_molecules/data-types/array/header/base-type'
import type { OpenPLCStore } from '../../../../store'
import { createStoreWrapper, createTestStore } from '../../../../store/testing'
import { VariablesEditor } from '../index'

let store: OpenPLCStore

const render = (ui: ReactElement) => rtlRender(ui, { wrapper: createStoreWrapper(store) })

function openSelect(trigger: HTMLElement) {
  fireEvent.keyDown(trigger, { key: 'Enter' })
}

function expectScrollsWithinTheWindow(listbox: HTMLElement) {
  expect(listbox.className).toMatch(/max-h-\[\d+px\]/)
  expect(listbox.className).toContain('overflow-y-auto')
  expect(listbox.className).not.toContain('overflow-hidden')
}

describe('type dropdowns stay inside the window', () => {
  beforeEach(() => {
    store = createTestStore()
  })

  it('caps the return type list and lets it scroll', () => {
    expect(store.getState().pouActions.create({ type: 'function', name: 'Scrolled', language: 'st' }).ok).toBe(true)
    render(<VariablesEditor name='Scrolled' />)

    openSelect(screen.getByLabelText('Return type :'))

    expectScrollsWithinTheWindow(screen.getByRole('listbox'))
  })

  it('offers every base type to a function, down to the last one', () => {
    expect(store.getState().pouActions.create({ type: 'function', name: 'Listed', language: 'st' }).ok).toBe(true)
    render(<VariablesEditor name='Listed' />)

    openSelect(screen.getByLabelText('Return type :'))

    for (const type of ['BOOL', 'DT', 'STRING', 'WSTRING']) {
      expect(screen.getByRole('option', { name: type })).toBeTruthy()
    }
  })

  it('caps the array base type list and lets it scroll', () => {
    render(<DTBaseTypeContainer />)

    openSelect(screen.getByRole('combobox'))

    expectScrollsWithinTheWindow(screen.getByRole('listbox'))
  })
})
