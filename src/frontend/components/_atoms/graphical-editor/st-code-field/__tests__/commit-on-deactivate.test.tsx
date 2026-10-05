import { act, render } from '@testing-library/react'

import { StCodeField } from '../index'

// The field stays mounted when `active` flips to false — only Monaco unmounts.
// A deselection that arrives without a pointerdown outside the field (keyboard
// navigation, or a programmatic selection change) has to commit the buffered
// draft, or the store keeps the old snippet while the read-only `<pre>` shows
// the newer one.

let editorOnChange: ((next: string) => void) | undefined

jest.mock('@monaco-editor/react', () => ({
  Editor: (props: { onChange?: (next: string) => void }) => {
    editorOnChange = props.onChange
    return null
  },
}))
jest.mock('../../../../../hooks/use-debug-value', () => ({ useIsDebuggerVisible: () => false }))
jest.mock('../../../../../hooks/use-st-debug-decorations', () => ({ useStDebugDecorations: () => undefined }))
jest.mock('../../../../../services/st-lsp/execute-sync', () => ({ getExecuteDraftApi: () => undefined }))
jest.mock('../../../../../store', () => ({ useOpenPLCStore: () => false }))
jest.mock('../../../../_features/[workspace]/editor/monaco/theme-utils', () => ({
  applyThemeNow: () => undefined,
  ensureOpenplcThemes: () => undefined,
}))

beforeEach(() => {
  editorOnChange = undefined
})

it('commits a buffered draft when the field is deselected', () => {
  const onCommit = jest.fn()
  const { rerender } = render(
    <StCodeField value='x := 1;' onCommit={onCommit} uri='inmemory://execute/Main/EXECUTE-1.st' active />,
  )

  act(() => editorOnChange?.('x := 2;'))
  expect(onCommit).not.toHaveBeenCalled()

  // Deselected without a click landing outside the field.
  rerender(
    <StCodeField value='x := 1;' onCommit={onCommit} uri='inmemory://execute/Main/EXECUTE-1.st' active={false} />,
  )

  expect(onCommit).toHaveBeenCalledWith('x := 2;')
})

it('does not commit when nothing was edited', () => {
  const onCommit = jest.fn()
  const { rerender } = render(
    <StCodeField value='x := 1;' onCommit={onCommit} uri='inmemory://execute/Main/EXECUTE-1.st' active />,
  )

  rerender(
    <StCodeField value='x := 1;' onCommit={onCommit} uri='inmemory://execute/Main/EXECUTE-1.st' active={false} />,
  )

  expect(onCommit).not.toHaveBeenCalled()
})
