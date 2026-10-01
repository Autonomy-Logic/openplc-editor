import { act, fireEvent, render, screen } from '@testing-library/react'

// The code view pulls in Monaco, which cannot run in jsdom. The stub is
// writable so a test can play the user typing into the buffer.
vi.mock('@root/frontend/components/_organisms/variables-code-editor', () => ({
  VariablesCodeEditor: ({ code, onCodeChange }: { code: string; onCodeChange: (value: string) => void }) => (
    <textarea data-testid='variables-code-editor' value={code} onChange={(event) => onCodeChange(event.target.value)} />
  ),
}))

const toastMock = vi.fn()
vi.mock('@root/frontend/components/_features/[app]/toast/use-toast', () => ({
  toast: (...args: unknown[]) => toastMock(...args),
  useToast: () => ({ toast: toastMock }),
}))

import { useOpenPLCStore } from '@root/frontend/store'
import { serializeDataTypeToText } from '@root/frontend/utils/PLC/data-type-serializer'

import { DataTypeEditor } from '../index'

const getState = () => useOpenPLCStore.getState()

/** Resolve the model the editor itself reads: the active one, else its entry in `editors`. */
const getBuffer = (name: string) => {
  const { editor, editors } = getState()
  const model = editor.meta.name === name ? editor : editors.find((candidate) => candidate.meta.name === name)
  if (model?.type !== 'plc-datatype' || model.structure.display !== 'code') return undefined
  return model.structure.code
}

const canonicalOf = (name: string) => {
  const dataType = getState().project.data.dataTypes.find((candidate) => candidate.name === name)
  return dataType ? serializeDataTypeToText(dataType) : undefined
}

const bufferText = () => {
  const textarea = screen.getByTestId('variables-code-editor')
  if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('code editor stub is not a textarea')
  return textarea.value
}

const typeInto = (text: string) => {
  fireEvent.change(screen.getByTestId('variables-code-editor'), { target: { value: text } })
}

const clickAway = async () => {
  await act(async () => {
    fireEvent.mouseDown(document.body)
  })
}

const seedMotor = () => {
  getState().datatypeActions.create({ name: 'Motor', derivation: 'structure' })
  getState().editorActions.updateModelStructureForName('Motor', { display: 'code' })
}

/** Legal but non-canonical: no spaces around the colon, four-space body indent. */
const TYPED = `TYPE\n    Motor : STRUCT\n        Speed:INT;\n    END_STRUCT;\nEND_TYPE\n`

describe('DataTypeEditor re-canonicalises the buffer after a commit', () => {
  beforeEach(() => {
    toastMock.mockClear()
    getState().sharedWorkspaceActions.clearStatesOnCloseProject()
  })

  it('replaces the typed text with the canonical serialisation', async () => {
    seedMotor()
    render(<DataTypeEditor dataTypeName='Motor' />)

    typeInto(TYPED)
    await clickAway()

    const canonical = canonicalOf('Motor')
    expect(canonical).toBeDefined()
    expect(canonical).not.toBe(TYPED)
    expect(bufferText()).toBe(canonical)
    expect(getBuffer('Motor')).toBe(canonical)
  })

  it('leaves the typed text alone when the commit fails', async () => {
    seedMotor()
    render(<DataTypeEditor dataTypeName='Motor' />)

    const broken = 'TYPE\n    Motor : STRUCT\n        oops\n'
    typeInto(broken)
    await clickAway()

    expect(bufferText()).toBe(broken)
    expect(toastMock).toHaveBeenCalled()
  })

  it('does not re-commit on the next blur', async () => {
    seedMotor()
    render(<DataTypeEditor dataTypeName='Motor' />)

    typeInto(TYPED)
    await clickAway()

    const undoDepth = () => getState().undoRedo['Motor']?.past.length ?? 0
    const afterFirst = undoDepth()
    expect(afterFirst).toBeGreaterThan(0)

    await clickAway()

    expect(undoDepth()).toBe(afterFirst)
  })
})
