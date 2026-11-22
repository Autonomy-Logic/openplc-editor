import { act, fireEvent, render as rtlRender, screen, within } from '@testing-library/react'
import type { ReactElement } from 'react'

// The variables code editor pulls in Monaco, which cannot run in jsdom.
vi.mock('@root/frontend/components/_organisms/variables-code-editor', () => ({
  VariablesCodeEditor: () => <div data-testid='variables-code-editor' />,
}))

import type { OpenPLCStore } from '../../../../store'
import { createStoreWrapper, createTestStore } from '../../../../store/testing'
import { EDITOR_ACTIONS_SLOT_ID } from '../../navigation'
import { VariablesEditor } from '../index'

let store: OpenPLCStore

const render = (ui: ReactElement) =>
  rtlRender(
    <>
      <div id={EDITOR_ACTIONS_SLOT_ID} />
      {ui}
    </>,
    { wrapper: createStoreWrapper(store) },
  )

const open = (name: string, type: 'program' | 'function' | 'function-block') => {
  expect(store.getState().pouActions.create({ type, name, language: 'st' }).ok).toBe(true)
  render(<VariablesEditor name={name} />)
}

const variables = (name: string) =>
  (store.getState().project.data.pous.find((pou) => pou.name === name)?.interface?.variables ?? []).map((v) => v.name)
const debugging = () => act(() => store.getState().workspaceActions.setDebuggerVisible(true))

describe('POU screen: variables first', () => {
  beforeEach(() => {
    store = createTestStore()
  })

  it('shows a function its return type as a pinned first row, and a program none', () => {
    open('ScaleRaw', 'function')
    const row = screen.getByLabelText('Return type row')
    expect(row.textContent).toContain('ScaleRaw')
    expect(within(row).getByLabelText('Return type')).toBeTruthy()

    expect(store.getState().pouActions.create({ type: 'program', name: 'Main2', language: 'st' }).ok).toBe(true)
    const program = rtlRender(<VariablesEditor name='Main2' />, { wrapper: createStoreWrapper(store) })
    expect(within(program.container).queryByLabelText('Return type row')).toBeNull()
  })

  it('adds, inserts and deletes rows from the Add variable row, the row menu and the keyboard, all locked in debug', () => {
    open('Main', 'program')
    fireEvent.click(screen.getByLabelText('Add variable'))
    fireEvent.click(screen.getByLabelText('Add variable'))
    expect(variables('Main')).toHaveLength(2)

    const rows = screen.getAllByRole('row').filter((row) => row.id !== '')
    fireEvent.contextMenu(rows[0])
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /Insert row above/ }))
    expect(variables('Main')).toHaveLength(3)

    fireEvent.keyDown(screen.getByLabelText('Variables editor table container'), { key: 'Enter' })
    expect(variables('Main')).toHaveLength(4)

    fireEvent.contextMenu(screen.getAllByRole('row').filter((row) => row.id !== '')[0])
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /Delete variable/ }))
    expect(variables('Main')).toHaveLength(3)

    debugging()
    expect(screen.getByLabelText<HTMLButtonElement>('Add variable').disabled).toBe(true)
  })

  it('edits the description in the POU properties popover, read only during debug', () => {
    open('Motor', 'function-block')
    fireEvent.click(screen.getByLabelText('POU properties'))
    const field = screen.getByLabelText<HTMLTextAreaElement>('POU description')
    fireEvent.change(field, { target: { value: 'Runs the motor' } })
    fireEvent.blur(field)
    expect(store.getState().project.data.pous.find((pou) => pou.name === 'Motor')?.documentation).toBe('Runs the motor')

    debugging()
    expect(screen.getByLabelText<HTMLTextAreaElement>('POU description').readOnly).toBe(true)
  })
})
