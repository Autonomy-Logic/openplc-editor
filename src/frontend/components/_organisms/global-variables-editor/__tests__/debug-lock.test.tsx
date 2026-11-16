import { act, fireEvent, render as rtlRender, screen } from '@testing-library/react'
import type { ReactElement } from 'react'

// The variables code editor pulls in Monaco, which cannot run in jsdom.
vi.mock('@root/frontend/components/_organisms/variables-code-editor', () => ({
  VariablesCodeEditor: () => <div data-testid='variables-code-editor' />,
}))

import type { OpenPLCStore } from '../../../../store'
import { CreateResourceEditor } from '../../../../store/slices/tabs/utils'
import { createStoreWrapper, createTestStore } from '../../../../store/testing'
import { GlobalVariablesEditor } from '../index'

let store: OpenPLCStore

const render = (ui: ReactElement) => rtlRender(ui, { wrapper: createStoreWrapper(store) })

const openDebugSession = () =>
  act(() => {
    store.getState().workspaceActions.setDebuggerVisible(true)
  })

const closeDebugSession = () =>
  act(() => {
    store.getState().workspaceActions.clearDebugState()
  })

const globalVariableCount = () => store.getState().project.data.configurations.resource.globalVariables.length

const renderEditor = () => {
  act(() => {
    store.getState().editorActions.setEditor(CreateResourceEditor())
  })
  render(<GlobalVariablesEditor />)
}

const addButton = () => screen.getByLabelText<HTMLButtonElement>('Add table row button')

const firstGlobalName = () => store.getState().project.data.configurations.resource.globalVariables[0]?.name

const addVariable = () => fireEvent.click(addButton())

const startEditingName = () => fireEvent.click(screen.getByText('GlobalVar'))

const nameInput = () => screen.queryByDisplayValue('GlobalVar')

describe('global variables editor during a debug session (TC11)', () => {
  beforeEach(() => {
    store = createTestStore()
  })

  it('should add a global variable while no debug session is open', () => {
    renderEditor()
    const before = globalVariableCount()

    fireEvent.click(addButton())

    expect(globalVariableCount()).toBe(before + 1)
  })

  it('should disable the add action while the debugger is open', () => {
    renderEditor()

    openDebugSession()

    expect(addButton().disabled).toBe(true)
  })

  it('should add no global variable when the locked add action is clicked', () => {
    renderEditor()
    const before = globalVariableCount()

    openDebugSession()
    fireEvent.click(addButton())

    expect(globalVariableCount()).toBe(before)
  })

  it('should release the add action once the debug session is closed', () => {
    renderEditor()

    openDebugSession()
    closeDebugSession()

    expect(addButton().disabled).toBe(false)
  })
})

describe('the global variables table cells during a debug session (TC11)', () => {
  beforeEach(() => {
    store = createTestStore()
  })

  it('should open the name cell for editing while no debug session is open', () => {
    renderEditor()
    addVariable()

    startEditingName()

    expect(nameInput()).not.toBeNull()
  })

  it('should keep the name cell closed while the debugger is open', () => {
    renderEditor()
    addVariable()

    openDebugSession()
    startEditingName()

    expect(nameInput()).toBeNull()
  })

  it('should leave the stored name untouched when the locked name cell is clicked', () => {
    renderEditor()
    addVariable()

    openDebugSession()
    startEditingName()

    expect(firstGlobalName()).toBe('GlobalVar')
  })

  it('should open the name cell again once the debug session is closed', () => {
    renderEditor()
    addVariable()

    openDebugSession()
    closeDebugSession()
    startEditingName()

    expect(nameInput()).not.toBeNull()
  })
})
