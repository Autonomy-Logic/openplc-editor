/**
 * What opening a project does to a POU's declaration text (DOPE-650).
 *
 * The text on disk is the source of truth, so the round trip through
 * `handleOpenProjectResponse` has to be byte-faithful — except where the editor
 * deliberately normalises, and there it must say so rather than quietly
 * reshaping the user's file.
 *
 * These run the real loader (`parseProjectFiles`) into the real store, because
 * every defect they cover lived in the seam between the two.
 */
import { parseProjectFiles } from '../../../backend/shared/utils/parse-project-files'
import { openPLCStoreBase } from '../index'

const PROJECT_JSON = JSON.stringify({
  meta: { name: 'P', type: 'plc-project' },
  data: { dataTypes: [], pous: [], configuration: { resource: { tasks: [], instances: [], globalVariables: [] } } },
})

const openWith = (declarations: string) => {
  openPLCStoreBase.getState().sharedWorkspaceActions.clearStatesOnCloseProject()
  const parsed = parseProjectFiles(
    '/p',
    PROJECT_JSON,
    JSON.stringify({ deviceBoard: 'uno', communicationPort: '', compileOnly: false }),
    JSON.stringify([]),
    [{ relativePath: 'pous/programs/main.st', content: `PROGRAM main\n${declarations}\n\na := 1;\n\nEND_PROGRAM` }],
    [],
    [],
  )
  openPLCStoreBase.getState().sharedWorkspaceActions.handleOpenProjectResponse(parsed)
  const pou = openPLCStoreBase.getState().project.data.pous.find((candidate) => candidate.name === 'main')
  if (!pou) throw new Error('main was not loaded')
  return pou
}

describe('opening a project', () => {
  it("leaves comments, blank lines and the user's own spelling byte for byte", () => {
    const declarations = 'VAR\n  (* header *)\n\n  a : INT;  (* how many *)\n  b : bool; // flag\nEND_VAR'
    const pou = openWith(declarations)

    expect(pou.variablesText).toBe(declarations)
    expect(pou.variablesTextUnparsed).toBeUndefined()
    expect(pou.interface?.variables.map((variable) => [variable.name, variable.documentation])).toEqual([
      ['a', 'how many'],
      ['b', 'flag'],
    ])
  })

  it('normalises a declaration naming several variables, copying its comment', () => {
    // Legal IEC that STruC++ reads, but the table cannot show it: the
    // Documentation column IS the comment at the end of the line, and two
    // variables on one line have one line between them.
    const pou = openWith('VAR\n  a, b : INT; (* both *)\nEND_VAR')

    expect(pou.variablesText).toBe('VAR\n  a : INT; (* both *)\n  b : INT; (* both *)\nEND_VAR')
    expect(pou.interface?.variables.map((variable) => variable.name)).toEqual(['a', 'b'])
  })

  it('keeps an invalid variable set as text and marks it for the code view', () => {
    // A hand-edited file can hold a set the editor would never have produced.
    // It used to be written into the store unvalidated; now the user gets their
    // own bytes back in the code view to repair.
    const pou = openWith('VAR\n  a : INT;\n  a : DINT;\nEND_VAR')

    expect(pou.variablesTextUnparsed).toBe(true)
    expect(pou.variablesText).toBe('VAR\n  a : INT;\n  a : DINT;\nEND_VAR')
  })

  it('keeps declarations that do not parse as text, for the same reason', () => {
    const pou = openWith('VAR\n  a : ;\nEND_VAR')

    expect(pou.variablesTextUnparsed).toBe(true)
    expect(pou.variablesText).toBe('VAR\n  a : ;\nEND_VAR')
  })
})
