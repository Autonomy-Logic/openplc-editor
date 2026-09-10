import { fireEvent, render, screen } from '@testing-library/react'

// The code view pulls in Monaco, which cannot run in jsdom.
vi.mock('@root/frontend/components/_organisms/variables-code-editor', () => ({
  VariablesCodeEditor: () => <div data-testid='variables-code-editor' />,
}))

import { useOpenPLCStore } from '@root/frontend/store'

import { DataTypeEditor } from '../index'

/** Reproduce what a go-to-definition redirect leaves behind. */
function arriveFromGotoDefinition(name: string) {
  const { editorActions } = useOpenPLCStore.getState()
  editorActions.updateModelStructureForName(name, { display: 'code' })
  editorActions.setEditorCursor(name, { lineNumber: 2, column: 3, offset: 0, target: 'data-type' })
}

describe('DataTypeEditor code view toggle', () => {
  it('lets the user switch back to the table after a goto-definition jump', () => {
    const created = useOpenPLCStore.getState().datatypeActions.create({ name: 'Motor', derivation: 'structure' })
    expect(created.ok).toBe(true)

    arriveFromGotoDefinition('Motor')
    render(<DataTypeEditor dataTypeName='Motor' />)
    expect(screen.getByTestId('variables-code-editor')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Data type table visualization'))

    // The jump's cursor is still on the model; it must not re-assert code
    // mode and pin the tab there.
    expect(screen.queryByTestId('variables-code-editor')).toBeNull()
  })
})
