import { act, fireEvent, render, screen } from '@testing-library/react'

// The variables code editor pulls in Monaco, which cannot run in jsdom. The
// stub is writable so a test can play the user typing into the buffer.
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

import { useOpenPLCStore } from '../../../../store'
import { generateIecVariablesToString } from '../../../../utils/generate-iec-variables-to-string'
import { VariablesEditor } from '../index'

const getState = () => useOpenPLCStore.getState()

const canonicalOf = (pouName: string) => {
  const pou = getState().project.data.pous.find((candidate) => candidate.name === pouName)
  return generateIecVariablesToString(pou?.interface?.variables ?? [])
}

const seedPou = (name: string) => {
  expect(getState().pouActions.create({ type: 'program', name, language: 'st' }).ok).toBe(true)
  getState().editorActions.updateModelVariablesForName(name, { display: 'code' })
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

/** Legal but non-canonical: no spaces around the colon, single-space indent. */
const TYPED = 'VAR\n Counter:INT;\nEND_VAR'

/** What the user actually types: their own spacing, and a comment. */
const TYPED_WITH_COMMENT = 'VAR\n  (* what it counts *)\n  Counter : INT;\nEND_VAR'

describe('VariablesEditor keeps the buffer the user typed after a commit', () => {
  beforeEach(() => {
    toastMock.mockClear()
    getState().sharedWorkspaceActions.clearStatesOnCloseProject()
  })

  it('keeps the typed text instead of replacing it with a serialisation', async () => {
    // The inverse of what this asserted for DOPE-622. Re-canonicalising the
    // buffer kept it in step with the synthesised LSP document, but it also
    // deleted every comment and every column of alignment the user had put
    // there (DOPE-650). The stub is now built from this same text, so the two
    // agree without the buffer having to be rewritten.
    seedPou('Main')
    render(<VariablesEditor name='Main' />)

    typeInto(TYPED)
    await clickAway()

    expect(bufferText()).toBe(TYPED)
    expect(canonicalOf('Main')).not.toBe(TYPED)
  })

  it('keeps a comment through a commit', async () => {
    seedPou('Commented')
    render(<VariablesEditor name='Commented' />)

    typeInto(TYPED_WITH_COMMENT)
    await clickAway()

    expect(bufferText()).toBe(TYPED_WITH_COMMENT)
    expect(bufferText()).toContain('(* what it counts *)')
  })

  it('records the typed text on the POU, so it survives a save', async () => {
    seedPou('Persisted')
    render(<VariablesEditor name='Persisted' />)

    typeInto(TYPED_WITH_COMMENT)
    await clickAway()

    const pou = getState().project.data.pous.find((candidate) => candidate.name === 'Persisted')
    expect(pou?.variablesText).toBe(TYPED_WITH_COMMENT)
    expect(pou?.interface?.variables.map((variable) => variable.name)).toEqual(['Counter'])
  })

  it('leaves the typed text alone when the commit fails', async () => {
    seedPou('Broken')
    render(<VariablesEditor name='Broken' />)

    const broken = 'VAR\n Counter :: NOPE;\nEND_VAR'
    typeInto(broken)
    await clickAway()

    expect(bufferText()).toBe(broken)
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Syntax error' }))
  })

  it('shows the POU\u2019s own declaration text when switching table \u2192 code', () => {
    // Caught in the browser, not by the suite: the text survived the load, but
    // toggling to code view re-rendered the buffer from the table and dropped
    // every comment on the way. Every buffer-filling path reads
    // `variablesText` now.
    const withComments = 'VAR\n  (* section header *)\n  Counter : INT;\n  // trailing note\nEND_VAR'
    expect(getState().pouActions.create({ type: 'program', name: 'FromDisk', language: 'st' }).ok).toBe(true)
    getState().projectActions.setPouVariablesText('FromDisk', withComments)
    getState().projectActions.setPouVariables({
      pouName: 'FromDisk',
      variables: [
        {
          name: 'Counter',
          class: 'local',
          type: { definition: 'base-type', value: 'INT' },
          location: '',
          documentation: '',
          debug: false,
        },
      ],
    })
    getState().editorActions.updateModelVariablesForName('FromDisk', { display: 'code' })

    render(<VariablesEditor name='FromDisk' />)

    expect(bufferText()).toBe(withComments)
  })

  it('does not re-commit on the next blur', async () => {
    seedPou('Once')
    render(<VariablesEditor name='Once' />)

    typeInto(TYPED)
    await clickAway()

    const undoDepth = () => getState().undoRedo['Once']?.past.length ?? 0
    const afterFirst = undoDepth()
    expect(afterFirst).toBeGreaterThan(0)

    await clickAway()

    expect(undoDepth()).toBe(afterFirst)
  })
})
