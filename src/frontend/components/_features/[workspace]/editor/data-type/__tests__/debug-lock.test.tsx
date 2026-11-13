import { act, fireEvent, render, screen } from '@testing-library/react'

import type { OpenPLCStore } from '@root/frontend/store'
import { createStoreWrapper, createTestStore } from '@root/frontend/store/testing'
import type { PLCDataType } from '@root/middleware/shared/ports/types'

import { DataTypeEditor } from '../index'

let store: OpenPLCStore

const TYPE = 'Motor'

const structure: PLCDataType = {
  name: TYPE,
  derivation: 'structure',
  variable: [{ name: 'Speed', type: { definition: 'base-type', value: 'DINT' } }],
}

const seed = () => {
  store.getState().datatypeActions.create({ name: TYPE, derivation: 'structure' })
  store.getState().projectActions.updateDatatype(TYPE, structure)
}

const openDebugSession = () =>
  act(() => {
    store.getState().workspaceActions.setDebuggerVisible(true)
  })

const closeDebugSession = () =>
  act(() => {
    store.getState().workspaceActions.clearDebugState()
  })

const renderEditor = () => render(<DataTypeEditor dataTypeName={TYPE} />, { wrapper: createStoreWrapper(store) })

const startRenaming = () => fireEvent.click(screen.getByLabelText('Data type name'))

const nameInput = () => screen.queryByLabelText('data-type-name')

const storedNames = () => store.getState().project.data.dataTypes.map((dataType) => dataType.name)

const contentFieldset = () => screen.getByLabelText('Data type content container').querySelector('fieldset')

describe('the data type editor during a debug session (TC11)', () => {
  beforeEach(() => {
    store = createTestStore()
    seed()
  })

  it('should open the name for renaming while no debug session is open', () => {
    renderEditor()

    startRenaming()

    expect(nameInput()).not.toBeNull()
  })

  it('should keep the name closed while the debugger is open', () => {
    renderEditor()

    openDebugSession()
    startRenaming()

    expect(nameInput()).toBeNull()
  })

  it('should leave the stored type name untouched while the debugger is open', () => {
    renderEditor()

    openDebugSession()
    startRenaming()

    expect(storedNames()).toContain(TYPE)
  })

  it('should render the members inside a disabled fieldset while the debugger is open', () => {
    renderEditor()

    openDebugSession()

    expect(contentFieldset()?.hasAttribute('disabled')).toBe(true)
  })

  it('should leave the members usable while no debug session is open', () => {
    renderEditor()

    expect(contentFieldset()?.hasAttribute('disabled')).toBe(false)
  })

  it('should open the name for renaming again once the debug session is closed', () => {
    renderEditor()

    openDebugSession()
    closeDebugSession()
    startRenaming()

    expect(nameInput()).not.toBeNull()
  })
})
