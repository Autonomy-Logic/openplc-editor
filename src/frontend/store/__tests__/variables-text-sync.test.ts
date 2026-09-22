/**
 * The declaration text and the variables model must never disagree (DOPE-650).
 *
 * The text is what gets serialised to disk and fed to the LSP, so a mutation
 * that changes the model without patching the text is a change the user made
 * and the file never received. That is silent data loss, and it is the failure
 * this phase exists to close.
 *
 * Every store action that writes `interface.variables` is covered here. When a
 * new one is added, it belongs in this list — the invariant is only as good as
 * the last writer someone remembered.
 */
import { useOpenPLCStore } from '../index'

const getState = () => useOpenPLCStore.getState()

const pouNamed = (name: string) => getState().project.data.pous.find((pou) => pou.name === name)
const textOf = (name: string) => pouNamed(name)?.variablesText
const varsOf = (name: string) => pouNamed(name)?.interface?.variables ?? []

const variable = (name: string, type = 'INT', location = '') => ({
  name,
  class: 'local' as const,
  type: { definition: 'base-type' as const, value: type },
  location,
  documentation: '',
  debug: false,
})

const seed = (name: string, text: string, variables: ReturnType<typeof variable>[]) => {
  expect(getState().pouActions.create({ type: 'program', name, language: 'st' }).ok).toBe(true)
  getState().projectActions.setPouVariablesText(name, text)
  getState().projectActions.setPouVariables({ pouName: name, variables })
}

describe('every writer keeps the text in step with the model', () => {
  beforeEach(() => {
    getState().sharedWorkspaceActions.clearStatesOnCloseProject()
  })

  it('setPouVariables patches the text', () => {
    seed('Direct', 'VAR\n  (* mine *)\n  a : INT;\nEND_VAR', [variable('a')])

    getState().projectActions.setPouVariables({
      pouName: 'Direct',
      variables: [variable('a', 'DINT')],
    })

    expect(textOf('Direct')).toContain('a : DINT;')
    // The comment the model cannot carry is still there.
    expect(textOf('Direct')).toContain('(* mine *)')
  })

  it('applyPouSnapshot — undo and redo — patches the text', () => {
    // The table reverted and the text did not, so the undo was discarded on the
    // next save.
    seed('Undone', 'VAR\n  (* mine *)\n  a : INT;\nEND_VAR', [variable('a')])
    getState().projectActions.setPouVariables({ pouName: 'Undone', variables: [variable('a', 'DINT')] })

    getState().projectActions.applyPouSnapshot('Undone', [variable('a', 'INT')], { language: 'st', value: '' })

    expect(varsOf('Undone')[0].type.value).toBe('INT')
    expect(textOf('Undone')).toContain('a : INT;')
    expect(textOf('Undone')).not.toContain('DINT')
    expect(textOf('Undone')).toContain('(* mine *)')
  })

  it('createVariable patches the text', () => {
    seed('Added', 'VAR\n  (* mine *)\n  a : INT;\nEND_VAR', [variable('a')])

    const response = getState().projectActions.createVariable({
      scope: 'local',
      associatedPou: 'Added',
      data: variable('b', 'BOOL'),
    })

    expect(response.ok).toBe(true)
    expect(textOf('Added')).toContain('b : BOOL;')
    expect(textOf('Added')).toContain('(* mine *)')
  })

  it('deleteVariable patches the text', () => {
    seed('Removed', 'VAR\n  (* mine *)\n  a : INT;\n  b : BOOL;\nEND_VAR', [variable('a'), variable('b', 'BOOL')])

    getState().projectActions.deleteVariable({ scope: 'local', associatedPou: 'Removed', rowId: 1 })

    expect(textOf('Removed')).not.toContain('b : BOOL;')
    expect(textOf('Removed')).toContain('a : INT;')
    expect(textOf('Removed')).toContain('(* mine *)')
  })

  it('renameAlias patches the text of every bound variable', () => {
    // The producer said the new name and the text still said the old one, so on
    // reopen the variable was bound to an alias nothing declares — unlocated at
    // compile time, which is what renameAlias exists to prevent.
    seed('Aliased', 'VAR\n  m : BOOL AT Old_Alias;\nEND_VAR', [variable('m', 'BOOL', 'Old_Alias')])

    getState().projectActions.renameAlias('Old_Alias', 'New_Alias')

    expect(varsOf('Aliased')[0].location).toBe('New_Alias')
    expect(textOf('Aliased')).toContain('AT New_Alias')
    expect(textOf('Aliased')).not.toContain('Old_Alias')
  })
})

describe('debug flags survive a reconcile', () => {
  beforeEach(() => {
    getState().sharedWorkspaceActions.clearStatesOnCloseProject()
  })

  it('keeps Debug ticked when an unrelated mutation re-parses the text', () => {
    // `debug` is editor metadata the declaration text cannot hold, so a
    // re-parse always returns `debug: false`. Replacing wholesale cleared every
    // tick in the POU the moment a block was dropped on the canvas.
    const text = 'VAR\n  (* mine *)\n  a : INT;\n  b : INT;\nEND_VAR'
    seed('Dbg', text, [
      { ...variable('a'), debug: true },
      { ...variable('b'), debug: true },
    ])
    getState().editorActions.updateModelVariablesForName('Dbg', { display: 'code', code: text })

    const response = getState().projectActions.createVariable({
      scope: 'local',
      associatedPou: 'Dbg',
      data: variable('c'),
    })

    expect(response.ok).toBe(true)
    expect(varsOf('Dbg').map((v) => [v.name, v.debug])).toEqual([
      ['a', true],
      ['b', true],
      ['c', false],
    ])
  })
})

describe('an open code view is the newest thing the user wrote', () => {
  beforeEach(() => {
    getState().sharedWorkspaceActions.clearStatesOnCloseProject()
  })

  const bufferOf = (name: string) => {
    const model =
      getState().editor.meta.name === name ? getState().editor : getState().editors.find((e) => e.meta.name === name)
    return model && 'variable' in model && model.variable.display === 'code' ? model.variable.code : undefined
  }

  it('patches the buffer, not the last-committed text, when the two differ', () => {
    // `commitCode` writes the variables BEFORE the text, so during a commit the
    // POU still holds the pre-edit text. Patching that instead of the buffer
    // rewrote the comment the user had just typed out of existence and then
    // pushed the result back over their editor.
    seed('Demo', 'VAR\n  a : INT;\nEND_VAR', [variable('a')])
    getState().editorActions.updateModelVariablesForName('Demo', {
      display: 'code',
      code: 'VAR\n  (* still typing *)\n  a : INT;\nEND_VAR',
    })

    expect(
      getState().projectActions.createVariable({ scope: 'local', associatedPou: 'Demo', data: variable('b', 'BOOL') })
        .ok,
    ).toBe(true)

    expect(textOf('Demo')).toBe('VAR\n  (* still typing *)\n  a : INT;\n  b : BOOL;\nEND_VAR')
    expect(bufferOf('Demo')).toBe(textOf('Demo'))
  })

  it('refuses a table edit while the buffer does not parse, rather than guessing', () => {
    seed('Half', 'VAR\n  a : INT;\nEND_VAR', [variable('a')])
    getState().editorActions.updateModelVariablesForName('Half', { display: 'code', code: 'VAR\n  a : INT;\n  b :' })

    const response = getState().projectActions.createVariable({
      scope: 'local',
      associatedPou: 'Half',
      data: variable('c', 'BOOL'),
    })

    expect(response.ok).toBe(false)
    expect(textOf('Half')).toBe('VAR\n  a : INT;\nEND_VAR')
  })

  it('falls back to the stored text when a writer that cannot refuse meets an unparseable buffer', () => {
    // Undo goes through `applyPouSnapshot`, which has no user to report a
    // syntax error to. Patching the half-typed buffer would hand
    // `applyVariablesToText` something it cannot scan, and its fallback is a
    // canonical re-serialisation — every comment in the POU gone, on an undo.
    seed('Undone', 'VAR\n  (* kept *)\n  a : INT;\nEND_VAR', [variable('a')])
    getState().editorActions.updateModelVariablesForName('Undone', {
      display: 'code',
      code: 'VAR\n  (* kept *)\n  a : INT;\n  b :',
    })

    getState().projectActions.applyPouSnapshot('Undone', [variable('a'), variable('c', 'BOOL')], {
      language: 'st',
      value: '',
    })

    expect(textOf('Undone')).toBe('VAR\n  (* kept *)\n  a : INT;\n  c : BOOL;\nEND_VAR')
  })
})
