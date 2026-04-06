import { collectDebugVariables, sanitizePou } from '../save-project'
import type { EditorLike } from '../save-project'
import type { PLCPou } from '../../../middleware/shared/ports/types'

// ---------------------------------------------------------------------------
// sanitizePou
// ---------------------------------------------------------------------------

describe('sanitizePou', () => {
  const basePou: PLCPou = {
    name: 'MyProgram',
    pouType: 'program',
    interface: { variables: [] },
    body: { language: 'st', value: '' },
    documentation: '',
  }

  it('returns the POU unchanged when editor is undefined', () => {
    expect(sanitizePou(basePou, undefined)).toBe(basePou)
  })

  it('returns the POU unchanged when editor type is not plc-textual or plc-graphical', () => {
    const editor: EditorLike = {
      type: 'other',
      meta: { name: 'MyProgram' },
      variable: { display: 'code', code: 'VAR\nEND_VAR' },
    }
    expect(sanitizePou(basePou, editor)).toBe(basePou)
  })

  it('returns the POU unchanged when editor has no variable property', () => {
    const editor: EditorLike = {
      type: 'plc-textual',
      meta: { name: 'MyProgram' },
    }
    expect(sanitizePou(basePou, editor)).toBe(basePou)
  })

  it('returns the POU unchanged when display is not code', () => {
    const editor: EditorLike = {
      type: 'plc-textual',
      meta: { name: 'MyProgram' },
      variable: { display: 'table' },
    }
    expect(sanitizePou(basePou, editor)).toBe(basePou)
  })

  it('returns the POU unchanged when display is code but code is null', () => {
    const editor: EditorLike = {
      type: 'plc-textual',
      meta: { name: 'MyProgram' },
      variable: { display: 'code', code: null },
    }
    expect(sanitizePou(basePou, editor)).toBe(basePou)
  })

  it('returns the POU unchanged when display is code but code is undefined', () => {
    const editor: EditorLike = {
      type: 'plc-textual',
      meta: { name: 'MyProgram' },
      variable: { display: 'code' },
    }
    expect(sanitizePou(basePou, editor)).toBe(basePou)
  })

  it('merges variablesText from editor when display is code and code is a non-null string', () => {
    const editor: EditorLike = {
      type: 'plc-textual',
      meta: { name: 'MyProgram' },
      variable: { display: 'code', code: 'VAR\n  x : INT;\nEND_VAR' },
    }
    const result = sanitizePou(basePou, editor)
    expect(result).not.toBe(basePou)
    expect((result as PLCPou & { variablesText?: string }).variablesText).toBe('VAR\n  x : INT;\nEND_VAR')
    expect(result.name).toBe(basePou.name)
  })

  it('works with plc-graphical editor type', () => {
    const editor: EditorLike = {
      type: 'plc-graphical',
      meta: { name: 'MyProgram' },
      variable: { display: 'code', code: 'VAR\nEND_VAR' },
    }
    const result = sanitizePou(basePou, editor)
    expect((result as PLCPou & { variablesText?: string }).variablesText).toBe('VAR\nEND_VAR')
  })

  it('returns POU with empty string code', () => {
    const editor: EditorLike = {
      type: 'plc-textual',
      meta: { name: 'MyProgram' },
      variable: { display: 'code', code: '' },
    }
    const result = sanitizePou(basePou, editor)
    expect((result as PLCPou & { variablesText?: string }).variablesText).toBe('')
  })
})

// ---------------------------------------------------------------------------
// collectDebugVariables
// ---------------------------------------------------------------------------

describe('collectDebugVariables', () => {
  it('returns undefined when no variables have debug enabled', () => {
    const globalVars = [{ name: 'g1', debug: false }]
    const pous: PLCPou[] = [
      {
        name: 'P1',
        pouType: 'program',
        interface: { variables: [{ name: 'x', type: { definition: 'base-type', value: 'INT' }, location: '', documentation: '', debug: false }] },
        body: { language: 'st', value: '' },
      },
    ]
    expect(collectDebugVariables(globalVars, pous)).toBeUndefined()
  })

  it('returns undefined when variables array is empty', () => {
    expect(collectDebugVariables([], [])).toBeUndefined()
  })

  it('returns only global debug variables when only globals have debug', () => {
    const globalVars = [
      { name: 'g1', debug: true },
      { name: 'g2', debug: false },
      { name: 'g3', debug: true },
    ]
    const result = collectDebugVariables(globalVars, [])
    expect(result).toEqual({ global: ['g1', 'g3'] })
  })

  it('returns only pou debug variables when only pous have debug', () => {
    const globalVars = [{ name: 'g1', debug: false }]
    const pous: PLCPou[] = [
      {
        name: 'P1',
        pouType: 'program',
        interface: {
          variables: [
            { name: 'a', type: { definition: 'base-type', value: 'INT' }, location: '', documentation: '', debug: true },
            { name: 'b', type: { definition: 'base-type', value: 'INT' }, location: '', documentation: '', debug: false },
          ],
        },
        body: { language: 'st', value: '' },
      },
    ]
    const result = collectDebugVariables(globalVars, pous)
    expect(result).toEqual({ pous: { P1: ['a'] } })
  })

  it('returns both global and pou debug variables', () => {
    const globalVars = [{ name: 'gDebug', debug: true }]
    const pous: PLCPou[] = [
      {
        name: 'Prog1',
        pouType: 'program',
        interface: {
          variables: [
            { name: 'v1', type: { definition: 'base-type', value: 'BOOL' }, location: '', documentation: '', debug: true },
          ],
        },
        body: { language: 'st', value: '' },
      },
      {
        name: 'Prog2',
        pouType: 'program',
        interface: {
          variables: [
            { name: 'v2', type: { definition: 'base-type', value: 'INT' }, location: '', documentation: '', debug: false },
          ],
        },
        body: { language: 'st', value: '' },
      },
    ]
    const result = collectDebugVariables(globalVars, pous)
    expect(result).toEqual({ global: ['gDebug'], pous: { Prog1: ['v1'] } })
  })

  it('handles pous with no interface', () => {
    const pous: PLCPou[] = [
      {
        name: 'P1',
        pouType: 'program',
        body: { language: 'st', value: '' },
      },
    ]
    const result = collectDebugVariables([], pous)
    expect(result).toBeUndefined()
  })

  it('handles pous with undefined variables array in interface', () => {
    const pous: PLCPou[] = [
      {
        name: 'P1',
        pouType: 'program',
        interface: { variables: undefined } as unknown as PLCPou['interface'],
        body: { language: 'st', value: '' },
      },
    ]
    const result = collectDebugVariables([], pous)
    expect(result).toBeUndefined()
  })
})
