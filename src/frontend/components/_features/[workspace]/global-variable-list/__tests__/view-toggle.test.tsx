import { fireEvent, render, screen } from '@testing-library/react'

// The declaration view pulls in Monaco, which cannot run in jsdom.
vi.mock('@root/frontend/components/_organisms/variables-code-editor', () => ({
  VariablesCodeEditor: ({ code }: { code: string }) => <div data-testid='variables-code-editor'>{code}</div>,
}))

import type { PLCGlobalVariableList } from '@root/middleware/shared/ports/types'
import { useOpenPLCStore } from '@root/frontend/store'
import { CreateEditorObjectFromTab } from '@root/frontend/store/slices/tabs/utils'

import { GlobalVariableListEditor } from '../index'

const member = (name: string, type = 'BOOL') => ({
  name,
  class: 'global' as const,
  type: { definition: 'base-type' as const, value: type },
  location: '',
  documentation: '',
})

/**
 * Seed the lists AND the editor model, the way opening the tab does.
 *
 * The model is where the view state lives, so a test that skips it is testing a component
 * the app never renders.
 */
function seed(lists: PLCGlobalVariableList[], openList?: string) {
  const model = openList
    ? CreateEditorObjectFromTab({
        name: openList,
        path: `/data/global-variables/${openList}`,
        elementType: { type: 'global-variable-list' },
      })
    : undefined
  useOpenPLCStore.setState((state) => ({
    ...state,
    project: { ...state.project, data: { ...state.project.data, globalVariableLists: lists } },
    editor: model ?? { type: 'available', meta: { name: 'available' } },
    editors: model ? [model] : [],
  }))
}

/** The name column of every DATA row — header rows carry `th`, not `td`. */
const rowNames = () =>
  screen
    .queryAllByRole('row')
    .filter((row) => row.querySelectorAll('td').length > 0)
    .map((row) => row.querySelectorAll('td')[1]?.textContent?.trim())

describe('GlobalVariableListEditor', () => {
  beforeEach(() => seed([]))

  it('opens on the table, with a row per member', () => {
    seed([{ name: 'GVL', variables: [member('Output1'), member('Speed', 'INT')] }], 'GVL')
    render(<GlobalVariableListEditor listName='GVL' />)

    expect(screen.queryByTestId('variables-code-editor')).toBeNull()
    expect(rowNames()).toEqual(['Output1', 'Speed'])
  })

  it('leaves out the columns a list cannot honour', () => {
    // An address on a list member drives nothing (the STRUCT it compiles to discards `AT`),
    // and nothing collects one into the debugger — so neither column is offered.
    seed([{ name: 'GVL', variables: [member('Output1')] }], 'GVL')
    render(<GlobalVariableListEditor listName='GVL' />)

    const headers = screen.getAllByRole('columnheader').map((header) => header.textContent?.trim())
    expect(headers).toEqual(['#', 'Name', 'Class', 'Type', 'Initial Value', 'Documentation'])
  })

  it('switches to the declaration and back', () => {
    seed([{ name: 'GVL', variables: [member('Output1')] }], 'GVL')
    render(<GlobalVariableListEditor listName='GVL' />)

    fireEvent.click(screen.getByLabelText('Global variable list code visualization'))
    expect(screen.getByTestId('variables-code-editor').textContent).toContain('Output1 : BOOL;')

    fireEvent.click(screen.getByLabelText('Global variable list table visualization'))
    expect(rowNames()).toEqual(['Output1'])
  })

  it('opens on the declaration when the saved text could not be parsed', () => {
    // The editor lets a broken declaration be saved rather than losing what was typed, so a
    // project can be RELOADED carrying one. Opening such a list on the table would show the
    // last good parse — members the file no longer says — and hide the text that needs
    // fixing. `variables` here is deliberately stale to make that visible if it regresses.
    seed(
      [
        {
          name: 'GVL',
          variables: [member('Output1')],
          text: 'VAR_GLOBAL\n  Output1 : BOOL\n  oops : ???\nEND_VAR\n',
        },
      ],
      'GVL',
    )
    render(<GlobalVariableListEditor listName='GVL' />)

    const view = screen.getByTestId('variables-code-editor')
    expect(view.textContent).toContain('oops : ???')
    expect(rowNames()).toEqual([])
  })

  it('keeps the user in the declaration while it does not parse', () => {
    // The table is built from members the broken text has not produced, so the switch is
    // refused — the same answer the POU variables and data type views give.
    seed(
      [
        {
          name: 'GVL',
          variables: [member('Output1')],
          text: 'VAR_GLOBAL\n  oops : ???\nEND_VAR\n',
        },
      ],
      'GVL',
    )
    render(<GlobalVariableListEditor listName='GVL' />)

    fireEvent.click(screen.getByLabelText('Global variable list table visualization'))
    expect(screen.getByTestId('variables-code-editor')).toBeTruthy()
    expect(rowNames()).toEqual([])
  })

  it('says so when the list is gone but its tab is still mounted', () => {
    seed([])
    render(<GlobalVariableListEditor listName='GVL' />)
    expect(screen.getByText('This global variable list no longer exists.')).toBeTruthy()
  })
})
