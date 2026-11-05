import { act, fireEvent, render as rtlRender, screen, within } from '@testing-library/react'
import type { ReactElement } from 'react'

// The variables code editor pulls in Monaco, which cannot run in jsdom.
vi.mock('@root/frontend/components/_organisms/variables-code-editor', () => ({
  VariablesCodeEditor: () => <div data-testid='variables-code-editor' />,
}))

import type { OpenPLCStore } from '../../../../store'
import { createStoreWrapper, createTestStore } from '../../../../store/testing'
import { VariablesEditor } from '../index'

let store: OpenPLCStore

const render = (ui: ReactElement) => rtlRender(ui, { wrapper: createStoreWrapper(store) })

const variableRow = () => screen.getAllByRole('row')[2]

const debugToggle = () => within(variableRow()).getByLabelText<HTMLButtonElement>('Toggle debug for this variable')

const variableInStore = () =>
  store.getState().project.data.pous.find((p) => p.name === 'main')?.interface?.variables[0]

const renderWithOneVariable = () => {
  expect(store.getState().pouActions.create({ type: 'program', name: 'main', language: 'ld' }).ok).toBe(true)
  expect(
    store.getState().projectActions.createVariable({
      scope: 'local',
      associatedPou: 'main',
      data: {
        name: 'TANK_LEVEL',
        type: { definition: 'base-type', value: 'int' },
        class: 'local',
        location: '',
        documentation: '',
      },
    }).ok,
  ).toBe(true)
  render(<VariablesEditor name='main' />)
  act(() => {
    store.getState().workspaceActions.setEditingState('saved')
  })
}

const openDebugSession = () =>
  act(() => {
    store.getState().workspaceActions.setDebuggerVisible(true)
  })

describe('the Debug column during a debug session (AC17)', () => {
  beforeEach(() => {
    store = createTestStore()
  })

  it('should keep the Debug toggle usable', () => {
    renderWithOneVariable()

    openDebugSession()

    expect(debugToggle().matches(':disabled')).toBe(false)
  })

  it('should tick the Debug flag of the variable', () => {
    renderWithOneVariable()
    openDebugSession()

    fireEvent.click(debugToggle())

    expect(variableInStore()?.debug).toBe(true)
  })

  it('should untick the Debug flag of the variable', () => {
    renderWithOneVariable()
    openDebugSession()

    fireEvent.click(debugToggle())
    fireEvent.click(debugToggle())

    expect(variableInStore()?.debug).toBe(false)
  })

  it('should raise the unsaved marker when the Debug flag changes', () => {
    renderWithOneVariable()
    openDebugSession()

    fireEvent.click(debugToggle())

    expect(store.getState().workspace.editingState).toBe('unsaved')
  })

  it('should keep the other cells of the same variable locked', () => {
    renderWithOneVariable()

    openDebugSession()

    const selects = within(variableRow()).getAllByRole<HTMLButtonElement>('combobox')
    expect(selects.length).toBeGreaterThan(0)
    for (const select of selects) {
      expect(select.matches(':disabled')).toBe(true)
    }
  })

  it('should not raise the unsaved marker just by opening the session', () => {
    renderWithOneVariable()

    openDebugSession()

    expect(store.getState().workspace.editingState).toBe('saved')
  })
})
