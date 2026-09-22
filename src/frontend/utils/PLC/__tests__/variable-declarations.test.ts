/**
 * Reading declarations with STruC++ (DOPE-650).
 *
 * The contract is that the editor and the compiler agree about what a
 * declaration is, because they are now the same parser. These tests pin the
 * mapping from its AST to the editor's model, and specifically cover every
 * input that a hand-written parser got wrong before it:
 *
 *   - `STRING := 'http://x'` — the scanner's comment pass ate the line at `//`
 *   - `STRING := 'a;b'` — the scanner cut the declaration inside the literal
 *   - `a : BOOL; b : INT;` — the scanner silently dropped `b`
 *   - `AT Motor Start` — the regex absorbed it into the type
 *   - `x : My Type;` — the regex invented a data type with that name
 */

import { normalizeOneVariablePerLine, parseVariableDeclarations } from '../variable-declarations'

const BASE_TYPES = new Set([
  'BOOL',
  'SINT',
  'INT',
  'DINT',
  'LINT',
  'USINT',
  'UINT',
  'UDINT',
  'ULINT',
  'BYTE',
  'WORD',
  'DWORD',
  'LWORD',
  'REAL',
  'LREAL',
  'TIME',
  'STRING',
  'WSTRING',
])

const context = {
  resolveBaseType: (name: string) => (BASE_TYPES.has(name.toUpperCase()) ? name.toUpperCase() : undefined),
  isFunctionBlockType: (name: string) => ['TON', 'TOF', 'CTU'].includes(name.toUpperCase()),
}

const parse = (source: string) => parseVariableDeclarations(source, context)

/** The variables, asserting a clean parse first so a failure names itself. */
const variablesOf = (source: string) => {
  const result = parse(source)
  expect(result.errors).toEqual([])
  return result.variables
}

/** One declaration wrapped in a plain VAR block. */
const one = (declaration: string) => variablesOf(`VAR\n  ${declaration}\nEND_VAR`)[0]

describe('the inputs that broke every previous parser', () => {
  it('reads a STRING holding a URL, where the // is not a comment', () => {
    const variable = one("url : STRING := 'http://example.com';")
    expect(variable.type).toEqual({ definition: 'base-type', value: 'STRING' })
    expect(variable.initialValue).toBe("'http://example.com'")
  })

  it('reads a STRING holding a semicolon, which does not end the declaration', () => {
    expect(one("s : STRING := 'a;b';").initialValue).toBe("'a;b'")
  })

  it('reads a STRING holding a comment opener', () => {
    expect(one("s : STRING := '(*';").initialValue).toBe("'(*'")
  })

  it('reads both declarations when two share a line', () => {
    const variables = variablesOf('VAR\n  a : BOOL; b : INT;\nEND_VAR')
    expect(variables.map((v) => v.name)).toEqual(['a', 'b'])
  })

  it('refuses a two-word type instead of inventing one', () => {
    expect(parse('VAR\n  x : My Type;\nEND_VAR').errors.length).toBeGreaterThan(0)
  })
})

describe('types', () => {
  it.each([
    ['BOOL', 'BOOL'],
    ['int', 'INT'],
    ['Real', 'REAL'],
    ['STRING', 'STRING'],
    ['TIME', 'TIME'],
  ])('resolves the elementary type %s', (written, canonical) => {
    expect(one(`a : ${written};`).type).toEqual({ definition: 'base-type', value: canonical })
  })

  it('classifies a function-block instance as derived', () => {
    expect(one('tmr : TON;').type).toEqual({ definition: 'derived', value: 'TON' })
  })

  it('classifies an unknown name as a user data type', () => {
    expect(one('s : MyStruct;').type).toEqual({ definition: 'user-data-type', value: 'MyStruct' })
  })

  it('reads a one-dimensional array with its bounds and element type', () => {
    expect(one('arr : ARRAY [0..3] OF INT;').type).toEqual({
      definition: 'array',
      value: 'ARRAY [0..3] OF INT',
      data: { baseType: { definition: 'base-type', value: 'INT' }, dimensions: [{ dimension: '0..3' }] },
    })
  })

  it('reads a multi-dimensional array', () => {
    const type = one('m : ARRAY [0..1, 0..2] OF REAL;').type
    expect(type.data?.dimensions).toEqual([{ dimension: '0..1' }, { dimension: '0..2' }])
  })

  it('reads an array of a user data type', () => {
    const type = one('m : ARRAY [0..3] OF MyStruct;').type
    expect(type.data?.baseType).toEqual({ definition: 'user-data-type', value: 'MyStruct' })
  })
})

describe('locations', () => {
  it.each([
    ['%QX0.0', 'a : BOOL AT %QX0.0;'],
    ['%IX1.7', 'a : BOOL AT %IX1.7;'],
    ['%MW10', 'a : INT AT %MW10;'],
  ])('reads the direct address %s', (expected, declaration) => {
    expect(one(declaration).location).toBe(expected)
  })

  it('reads a direct address written before the colon', () => {
    expect(one('a AT %QX0.0 : BOOL;').location).toBe('%QX0.0')
  })

  it('reads an alias, keeping the spelling the user typed', () => {
    // The AST folds identifier case, so this comes from the source span. Losing
    // it would rename `Motor_Start` to `MOTOR_START` on the next save.
    expect(one('m : BOOL AT Motor_Start;').location).toBe('Motor_Start')
  })

  it('reads an alias written before the colon', () => {
    expect(one('m AT Motor_Start : BOOL;').location).toBe('Motor_Start')
  })

  it('reads a located array, which the compiler accepts for one dimension', () => {
    const variable = one('arr AT %MW0 : ARRAY [0..3] OF INT;')
    expect(variable.location).toBe('%MW0')
    expect(variable.type.definition).toBe('array')
  })

  it('leaves an unlocated declaration empty rather than undefined', () => {
    expect(one('a : BOOL;').location).toBe('')
  })
})

describe('initial values', () => {
  it.each([
    ['7', 'a : INT := 7;'],
    ['-7', 'a : INT := -7;'],
    ['3.14', 'a : REAL := 3.14;'],
    ['TRUE', 'a : BOOL := TRUE;'],
    ['T#1s', 'a : TIME := T#1s;'],
    ['16#FF', 'a : INT := 16#FF;'],
  ])('reads %s', (expected, declaration) => {
    expect(one(declaration).initialValue).toBe(expected)
  })

  it('is null rather than empty when there is none', () => {
    expect(one('a : INT;').initialValue).toBeNull()
  })
})

describe('documentation, which the AST does not carry', () => {
  it('reads a trailing block comment', () => {
    expect(one('a : INT; (* how many *)').documentation).toBe('how many')
  })

  it('reads a trailing line comment', () => {
    expect(one('a : INT; // how many').documentation).toBe('how many')
  })

  it('reads documentation after an initial value and a location', () => {
    expect(one('a : INT AT %MW0 := 1; (* both *)').documentation).toBe('both')
  })

  it('does not take a comment on the following line', () => {
    // A section header above a declaration describes the section, not the
    // variable under it.
    const variables = variablesOf('VAR\n  a : INT;\n  (* --- timers --- *)\n  t : INT;\nEND_VAR')
    expect(variables.map((v) => v.documentation)).toEqual(['', ''])
  })

  it('leaves documentation empty when there is no comment', () => {
    expect(one('a : INT;').documentation).toBe('')
  })
})

describe('comments are trivia everywhere else', () => {
  it.each([
    ['a standalone block comment', 'VAR\n  (* note *)\n  a : INT;\nEND_VAR'],
    ['a multi-line block comment', 'VAR\n  (* one\n     two *)\n  a : INT;\nEND_VAR'],
    ['a standalone line comment', 'VAR\n  // note\n  a : INT;\nEND_VAR'],
    ['a comment before the block', '(* head *)\nVAR\n  a : INT;\nEND_VAR'],
    ['a comment between blocks', 'VAR\n  a : INT;\nEND_VAR\n(* mid *)\nVAR_INPUT\n  b : INT;\nEND_VAR'],
  ])('accepts %s', (_label, source) => {
    expect(parse(source).errors).toEqual([])
  })

  it('ignores a declaration that only exists inside a comment', () => {
    expect(variablesOf('VAR\n  (* b : INT; *)\n  a : INT;\nEND_VAR').map((v) => v.name)).toEqual(['a'])
  })
})

describe('blocks, classes and qualifiers', () => {
  it.each([
    ['VAR', 'local', undefined],
    ['VAR_INPUT', 'input', undefined],
    ['VAR_OUTPUT', 'output', undefined],
    ['VAR_IN_OUT', 'inOut', undefined],
    ['VAR_EXTERNAL', 'external', undefined],
    ['VAR_TEMP', 'temp', undefined],
  ])('maps %s to class %s', (keyword, expectedClass) => {
    const variable = variablesOf(`${keyword}\n  a : INT;\nEND_VAR`)[0]
    expect(variable.class).toBe(expectedClass)
  })

  it.each([
    ['VAR CONSTANT', 'constant'],
    ['VAR RETAIN', 'retain'],
    // PERSISTENT folds into retain, as it always has: this toolchain does not
    // keep values across a download, so the honest mapping is the weaker
    // guarantee the two share. STruC++ folds it the same way.
    ['VAR PERSISTENT', 'retain'],
    ['VAR RETAIN PERSISTENT', 'retain'],
  ])('maps the qualifier on %s to %s', (header, expectedFlag) => {
    expect(variablesOf(`${header}\n  a : INT := 1;\nEND_VAR`)[0].flag).toBe(expectedFlag)
  })

  it('leaves NON_RETAIN unflagged, since it names the default', () => {
    expect(variablesOf('VAR NON_RETAIN\n  a : INT;\nEND_VAR')[0].flag).toBeUndefined()
  })

  it('accepts lowercase keywords', () => {
    expect(variablesOf('var constant\n  a : INT := 1;\nend_var')[0].flag).toBe('constant')
  })

  it('reads several blocks in order', () => {
    const variables = variablesOf('VAR\n  a : INT;\nEND_VAR\nVAR_INPUT\n  b : BOOL;\nEND_VAR')
    expect(variables.map((v) => [v.name, v.class])).toEqual([
      ['a', 'local'],
      ['b', 'input'],
    ])
  })
})

describe('spelling comes from the source, never the folded AST', () => {
  it('keeps a camelCase variable name', () => {
    expect(one('MyCamelVar : INT;').name).toBe('MyCamelVar')
  })

  it('keeps the spelling of a user data type', () => {
    expect(one('s : MyStruct;').type.value).toBe('MyStruct')
  })
})

describe('spans address the caller source', () => {
  const source = 'VAR\n  counter : INT AT %MW0 := 7; (* how many *)\nEND_VAR'

  it('spans each field exactly', () => {
    const [block] = parse(source).blocks
    const [declaration] = block.declarations
    const at = (span: { start: number; end: number }) => source.slice(span.start, span.end)

    const { location, initialValue, documentation } = declaration.fields
    // Narrowed rather than asserted: an absent span is a real failure of the
    // parser, and `!` would report it as an unreadable TypeError instead.
    if (!location || !initialValue || !documentation) throw new Error('declaration is missing an optional span')

    expect(at(declaration.fields.name)).toBe('counter')
    expect(at(declaration.fields.type)).toBe('INT')
    expect(at(location)).toBe('%MW0')
    expect(at(initialValue)).toBe('7')
    expect(at(documentation).trim()).toBe('how many')
  })

  it('spans the block header and END_VAR', () => {
    const [block] = parse(source).blocks
    expect(source.slice(block.headerSpan.start, block.headerSpan.end).trim()).toBe('VAR')
    expect(source.slice(block.endVarSpan.start, block.endVarSpan.end).trim()).toBe('END_VAR')
  })

  it('keeps spans correct when a comment sits earlier in the text', () => {
    const withComment = 'VAR\n  (* a long preamble *)\n  counter : INT;\nEND_VAR'
    const [declaration] = parse(withComment).blocks[0].declarations
    expect(withComment.slice(declaration.fields.name.start, declaration.fields.name.end)).toBe('counter')
  })

  it('reports the declaration line in the caller source, not the wrapped one', () => {
    const [declaration] = parse(source).blocks[0].declarations
    expect(declaration.line).toBe(2)
  })
})

describe('errors', () => {
  it('reports a syntax error against the caller line', () => {
    const result = parse('VAR\n  a : ;\nEND_VAR')
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0].line).toBeGreaterThanOrEqual(1)
  })

  it('returns no blocks rather than throwing on nonsense', () => {
    expect(() => parse('%%%')).not.toThrow()
  })

  it('reads an empty block without inventing a variable', () => {
    const result = parse('VAR\nEND_VAR')
    expect(result.errors).toEqual([])
    expect(result.variables).toEqual([])
  })
})

describe('errors a user can act on', () => {
  it('names a bad VAR qualifier, on the line it is written', () => {
    // STruC++ resynchronises after the bad token and reports against the NEXT
    // line — the one line in the block with nothing wrong with it.
    const [error] = parseVariableDeclarations('VAR FOO\n  a : INT;\nEND_VAR', context).errors
    expect(error.message).toBe(
      'Unknown variable block qualifier "FOO". Expected CONSTANT, RETAIN, NON_RETAIN or PERSISTENT.',
    )
    expect(error.line).toBe(1)
  })

  it('explains a declared STRING length instead of pointing at the bracket', () => {
    const [error] = parseVariableDeclarations('VAR\n  s : STRING[20];\nEND_VAR', context).errors
    expect(error.message).toContain('A declared length is not supported on STRING')
    expect(error.line).toBe(2)
  })

  it('explains it for a WSTRING inside an array too', () => {
    const [error] = parseVariableDeclarations('VAR\n  s : ARRAY [0..3] OF WSTRING[20];\nEND_VAR', context).errors
    expect(error.message).toContain('A declared length is not supported on WSTRING')
  })

  it('leaves a legal qualifier and a qualifier named in a comment alone', () => {
    expect(parseVariableDeclarations('VAR RETAIN\n  a : INT;\nEND_VAR', context).errors).toEqual([])
    expect(parseVariableDeclarations('VAR (* RETAIN later *)\n  a : INT;\nEND_VAR', context).errors).toEqual([])
  })

  it("keeps the parser's own report for anything else", () => {
    const [error] = parseVariableDeclarations('VAR\n  a : ;\nEND_VAR', context).errors
    expect(error.message).not.toContain('qualifier')
    expect(error.message).not.toContain('declared length')
  })
})

describe('a whole POU is recognised behind its documentation', () => {
  it('does not wrap a POU that opens with a block comment', () => {
    // Wrapping it produced a POU nested in a POU, which STruC++ rejects — so a
    // documented POU came back with no variables at all.
    const source = '(* documentation *)\nPROGRAM Main\nVAR\n  a : INT;\nEND_VAR\n;\nEND_PROGRAM'
    const result = parseVariableDeclarations(source, context)
    expect(result.errors).toEqual([])
    expect(result.variables.map((variable) => variable.name)).toEqual(['a'])
  })

  it('does not wrap a POU that opens with line comments', () => {
    const source = '// notes\n// more notes\nPROGRAM Main\nVAR\n  a : INT;\nEND_VAR\n;\nEND_PROGRAM'
    expect(parseVariableDeclarations(source, context).errors).toEqual([])
  })
})

describe('normalizeOneVariablePerLine', () => {
  // The Documentation column is the comment at the end of a line, so two
  // variables sharing a line have one comment between them. The short form is
  // accepted and rewritten rather than refused.
  it('splits a multi-name declaration', () => {
    expect(normalizeOneVariablePerLine('VAR\n  a, b : INT;\nEND_VAR', context)).toBe(
      'VAR\n  a : INT;\n  b : INT;\nEND_VAR',
    )
  })

  it('copies the trailing comment onto each line, since it described both', () => {
    expect(normalizeOneVariablePerLine('VAR\n  a, b : INT; (* both *)\nEND_VAR', context)).toBe(
      'VAR\n  a : INT; (* both *)\n  b : INT; (* both *)\nEND_VAR',
    )
  })

  it('carries the location and initial value onto each line', () => {
    const out = normalizeOneVariablePerLine('VAR\n  a, b : INT := 5;\nEND_VAR', context)
    expect(out).toContain('a : INT := 5;')
    expect(out).toContain('b : INT := 5;')
  })

  it('preserves the indentation of the original', () => {
    expect(normalizeOneVariablePerLine('VAR\n\t\ta, b : INT;\nEND_VAR', context)).toBe(
      'VAR\n\t\ta : INT;\n\t\tb : INT;\nEND_VAR',
    )
  })

  it('leaves single-name declarations completely alone', () => {
    const source = 'VAR\n  (* keep *)\n  a : INT;\n  b : BOOL;\nEND_VAR'
    expect(normalizeOneVariablePerLine(source, context)).toBe(source)
  })

  it('returns the text untouched when it cannot be parsed', () => {
    const broken = 'VAR\n  a : ;\nEND_VAR'
    expect(normalizeOneVariablePerLine(broken, context)).toBe(broken)
  })
})
