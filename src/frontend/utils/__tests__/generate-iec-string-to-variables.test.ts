import type { LibraryState, SystemLibrary, SystemLibraryPou } from '../../../middleware/shared/ports/library-types'
import type { PLCPou, PLCVariable } from '../../../middleware/shared/ports/types'
import { validateVariableSet } from '../../store/slices/project/validation/variables'
import {
  duplicateVariableNameMessage,
  findDuplicateVariableName,
  parseIecStringToVariables,
} from '../generate-iec-string-to-variables'

/**
 * Fully-typed library fixtures.
 *
 * `as unknown as LibraryState['libraries']` was hiding the contract: a field
 * added to `SystemLibraryPou` would leave these fixtures compiling against a
 * shape the production code no longer sees.
 */
const libraryPou = (name: string): SystemLibraryPou => ({
  name,
  type: 'function-block',
  language: 'st',
  variables: [],
  body: '',
  documentation: '',
})

const systemLibrary = (name: string, pous: SystemLibraryPou[]): SystemLibrary => ({
  name,
  author: '',
  version: '1.0.0',
  stPath: '',
  cPath: '',
  pous,
})

describe('parseIecStringToVariables — the throwing facade', () => {
  // The parsing itself is STruC++'s and is covered in
  // `PLC/__tests__/variable-declarations.test.ts`. What this file owns is the
  // facade: it throws on the first problem (so the callers that cannot handle a
  // list keep working), and it builds the type context from the project, which
  // is the one classification the compiler cannot make for us.

  it('returns the variables for a clean block', () => {
    const variables = parseIecStringToVariables('VAR\n  a : INT;\n  b : BOOL;\nEND_VAR')
    expect(variables.map((variable) => variable.name)).toEqual(['a', 'b'])
  })

  it('throws on a malformed declaration rather than returning a partial list', () => {
    expect(() => parseIecStringToVariables('VAR\n  a : ;\nEND_VAR')).toThrow()
  })

  it('accepts a multi-name declaration, which the compiler accepts', () => {
    // The old regex refused this. STruC++ reads it, so the editor does too and
    // normalises the text to one declaration per line instead of refusing.
    const variables = parseIecStringToVariables('VAR\n  a, b : INT;\nEND_VAR')
    expect(variables.map((variable) => variable.name)).toEqual(['a', 'b'])
  })

  it('reads a block with no declarations as no variables', () => {
    expect(parseIecStringToVariables('VAR\nEND_VAR')).toEqual([])
  })

  it('ignores text outside a VAR block', () => {
    const variables = parseIecStringToVariables('PROGRAM x\nVAR\n  a : INT;\nEND_VAR\nEND_PROGRAM')
    expect(variables.map((variable) => variable.name)).toEqual(['a'])
  })
})

describe('buildTypeContext — the classification the compiler cannot make', () => {
  const fbPou: PLCPou = {
    name: 'MyBlock',
    pouType: 'function-block',
    interface: { variables: [] },
    body: { language: 'st', value: '' },
  }
  const programPou: PLCPou = { ...fbPou, name: 'MyProgram', pouType: 'program' }

  const typeOf = (declaration: string, pous?: PLCPou[], libraries?: LibraryState['libraries']) =>
    parseIecStringToVariables(`VAR\n  ${declaration}\nEND_VAR`, pous, undefined, libraries)[0].type

  it('classifies a user function block as derived', () => {
    expect(typeOf('x : MyBlock;', [fbPou])).toEqual({ definition: 'derived', value: 'MyBlock' })
  })

  it('matches a function block name case-insensitively', () => {
    expect(typeOf('x : myblock;', [fbPou])).toEqual({ definition: 'derived', value: 'myblock' })
  })

  it('does not classify a program POU as a function block', () => {
    expect(typeOf('x : MyProgram;', [programPou])).toEqual({ definition: 'user-data-type', value: 'MyProgram' })
  })

  it('classifies a system library function block as derived', () => {
    const libraries = {
      system: [systemLibrary('Standard', [libraryPou('TON')])],
      user: [],
    } satisfies LibraryState['libraries']
    expect(typeOf('t : TON;', [], libraries)).toEqual({ definition: 'derived', value: 'TON' })
  })

  it('classifies a user library function block as derived', () => {
    const libraries = {
      system: [],
      user: [{ name: 'MyLibFb', type: 'function-block' }],
    } satisfies LibraryState['libraries']
    expect(typeOf('x : MyLibFb;', [], libraries)).toEqual({ definition: 'derived', value: 'MyLibFb' })
  })

  it('leaves an unknown name as a user data type', () => {
    expect(typeOf('x : Whatever;', [])).toEqual({ definition: 'user-data-type', value: 'Whatever' })
  })

  it('resolves an elementary type to its canonical spelling', () => {
    expect(typeOf('x : int;', [])).toEqual({ definition: 'base-type', value: 'INT' })
  })

  it('works with no project context at all', () => {
    expect(typeOf('x : TON;')).toEqual({ definition: 'user-data-type', value: 'TON' })
  })
})

describe('findDuplicateVariableName', () => {
  const variable = (name: string): PLCVariable => ({
    name,
    class: 'local',
    type: { definition: 'base-type', value: 'INT' },
    location: '',
    documentation: '',
  })

  it('returns undefined when every name is unique', () => {
    expect(findDuplicateVariableName([variable('Motor'), variable('Speed')])).toBeUndefined()
    expect(findDuplicateVariableName([])).toBeUndefined()
  })

  it('returns the second spelling of a name declared twice, folding case like IEC does', () => {
    expect(findDuplicateVariableName([variable('Motor'), variable('Speed'), variable('motor')])).toBe('motor')
    expect(findDuplicateVariableName([variable('Motor'), variable('Motor')])).toBe('Motor')
  })

  it('names the variable in the message', () => {
    expect(duplicateVariableNameMessage('motor')).toBe(
      '"motor" is declared more than once. Please make sure that the name is unique.',
    )
  })
})
