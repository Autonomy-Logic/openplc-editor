import * as iecStringModule from '../../generate-iec-string-to-variables'
import {
  detectLanguageFromExtension,
  extractVariablesSection,
  findGraphicalBodyStartIndex,
  findLastEndVarIndex,
  matchPouHeader,
  parseGraphicalPouFromString,
  parseHybridPouFromString,
  parseTextualPouFromString,
} from '../pou-text-parser'

/** The message of the error `run` throws, or `PARSED OK` when it returns. */
const messageOf = (run: () => unknown): string => {
  try {
    run()
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  return 'PARSED OK'
}

// ---------------------------------------------------------------------------
// findLastEndVarIndex
// ---------------------------------------------------------------------------
describe('findLastEndVarIndex', () => {
  it('finds the index after the last END_VAR', () => {
    const content = 'VAR x : INT; END_VAR VAR y : BOOL; END_VAR body'
    const idx = findLastEndVarIndex(content, 0)
    expect(idx).toBe(content.lastIndexOf('END_VAR') + 'END_VAR'.length)
  })

  it('returns -1 when no END_VAR is found', () => {
    const content = 'VAR x : INT;'
    expect(findLastEndVarIndex(content, 0)).toBe(-1)
  })

  it('starts searching from the given start index', () => {
    const content = 'END_VAR first END_VAR second'
    // Search starting from after the first END_VAR
    const startAfterFirst = 'END_VAR'.length
    const idx = findLastEndVarIndex(content, startAfterFirst)
    expect(idx).toBe(content.lastIndexOf('END_VAR') + 'END_VAR'.length)
  })

  it('is case-insensitive', () => {
    const content = 'VAR x : INT; end_var body'
    const idx = findLastEndVarIndex(content, 0)
    expect(idx).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// parseTextualPouFromString — programs
// ---------------------------------------------------------------------------
describe('parseTextualPouFromString', () => {
  it('parses a simple ST program', () => {
    const content = `PROGRAM Main
VAR
  x : INT;
END_VAR

x := 1;

END_PROGRAM`

    const result = parseTextualPouFromString(content, 'st', 'program')
    expect(result.name).toBe('Main')
    expect(result.pouType).toBe('program')
    expect(result.body.language).toBe('st')
    expect(result.body.value).toBe('x := 1;')
    expect(result.documentation).toBe('')
  })

  it('parses an IL program', () => {
    const content = `PROGRAM IlProg
VAR
  x : INT;
END_VAR

LD x

END_PROGRAM`

    const result = parseTextualPouFromString(content, 'il', 'program')
    expect(result.name).toBe('IlProg')
    expect(result.body.language).toBe('il')
    expect(result.body.value).toBe('LD x')
  })

  it('parses documentation comments', () => {
    const content = `(* This is documented *)

PROGRAM Main
VAR
  x : INT;
END_VAR

x := 1;

END_PROGRAM`

    const result = parseTextualPouFromString(content, 'st', 'program')
    expect(result.documentation).toBe('This is documented')
  })

  it('parses a function with return type', () => {
    const content = `FUNCTION MyFunc : INT
VAR_INPUT
  a : INT;
END_VAR

MyFunc := a + 1;

END_FUNCTION`

    const result = parseTextualPouFromString(content, 'st', 'function')
    expect(result.name).toBe('MyFunc')
    expect(result.pouType).toBe('function')
    expect(result.interface?.returnType).toBe('INT')
    expect(result.interface?.variables.length).toBe(1)
    expect(result.interface?.variables[0].name).toBe('a')
    expect(result.interface?.variables[0].class).toBe('input')
  })

  it('parses a function-block', () => {
    const content = `FUNCTION_BLOCK MyFB
VAR
  state : BOOL;
END_VAR

state := NOT state;

END_FUNCTION_BLOCK`

    const result = parseTextualPouFromString(content, 'st', 'function-block')
    expect(result.name).toBe('MyFB')
    expect(result.pouType).toBe('function-block')
  })

  it('parses a program with no variables', () => {
    const content = `PROGRAM NoVars

x := 1;

END_PROGRAM`

    const result = parseTextualPouFromString(content, 'st', 'program')
    expect(result.interface?.variables).toEqual([])
    expect(result.body.value).toBe('x := 1;')
  })

  it('parses multiple variable blocks', () => {
    const content = `PROGRAM Multi
VAR_INPUT
  a : INT;
END_VAR
VAR_OUTPUT
  b : INT;
END_VAR

b := a;

END_PROGRAM`

    const result = parseTextualPouFromString(content, 'st', 'program')
    expect(result.interface?.variables.length).toBe(2)
  })

  it('reports a VAR block without END_VAR as a parse error on the VAR line', () => {
    const content = `PROGRAM Main
VAR x : INT;
x := 1;
END_PROGRAM`
    expect(() => parseTextualPouFromString(content, 'st', 'program')).toThrow(/Parse error on line 2: .*END_VAR/)
  })

  it('reports a second declaration block without END_VAR as a parse error on its own line', () => {
    const content = `PROGRAM Main
VAR
  x : INT;
END_VAR
VAR_TEMP
  y : INT;

x := y;
END_PROGRAM`
    expect(() => parseTextualPouFromString(content, 'st', 'program')).toThrow(/Parse error on line 5: .*END_VAR/)
  })

  it('keeps a closed declaration block that is followed only by body statements', () => {
    const content = `PROGRAM Main
VAR
  x : INT;
END_VAR

x := 1;
END_PROGRAM`

    const result = parseTextualPouFromString(content, 'st', 'program')

    expect(result.interface?.variables.map((variable) => variable.name)).toEqual(['x'])
    expect(result.body.value).toBe('x := 1;')
  })

  // -------------------------------------------------------------------------
  // Error cases
  // -------------------------------------------------------------------------
  it('throws for unsupported POU type', () => {
    const content = 'PROGRAM Main\nEND_PROGRAM'
    expect(() => parseTextualPouFromString(content, 'st', 'unknown')).toThrow('Unsupported POU type')
  })

  it('throws when declaration is not found', () => {
    const content = 'x := 1;\nEND_PROGRAM'
    expect(() => parseTextualPouFromString(content, 'st', 'program')).toThrow('Could not find PROGRAM declaration')
  })

  it('throws when function has no return type', () => {
    const content = 'FUNCTION NoReturn\nEND_FUNCTION'
    expect(() => parseTextualPouFromString(content, 'st', 'function')).toThrow('must have a return type')
  })

  it('throws when end keyword is missing', () => {
    const content = 'PROGRAM Main\nVAR\n  x : INT;\nEND_VAR\nx := 1;'
    expect(() => parseTextualPouFromString(content, 'st', 'program')).toThrow('Could not find END_PROGRAM')
  })
})

// ---------------------------------------------------------------------------
// parseHybridPouFromString
// ---------------------------------------------------------------------------
describe('parseHybridPouFromString', () => {
  it('parses a Python program', () => {
    const content = `PROGRAM PyMain
VAR
  x : INT;
END_VAR
print("hello")
END_PROGRAM`

    const result = parseHybridPouFromString(content, 'python', 'program')
    expect(result.name).toBe('PyMain')
    expect(result.pouType).toBe('program')
    expect(result.body.language).toBe('python')
    expect(result.body.value).toBe('print("hello")')
  })

  it('parses a C++ program', () => {
    const content = `PROGRAM CppMain
VAR
  y : BOOL;
END_VAR
void setup() {}
void loop() {}
END_PROGRAM`

    const result = parseHybridPouFromString(content, 'cpp', 'program')
    expect(result.name).toBe('CppMain')
    expect(result.body.language).toBe('cpp')
  })

  it('parses documentation', () => {
    const content = `(* Hybrid doc *)

PROGRAM HybridPou
print("doc")
END_PROGRAM`

    const result = parseHybridPouFromString(content, 'python', 'program')
    expect(result.documentation).toBe('Hybrid doc')
  })

  it('strips the END keyword from body', () => {
    const content = `PROGRAM Main
code here
END_PROGRAM`

    const result = parseHybridPouFromString(content, 'python', 'program')
    expect(result.body.value).not.toContain('END_PROGRAM')
  })

  it('parses a function with return type', () => {
    const content = `FUNCTION MyFunc : INT
return 42
END_FUNCTION`

    const result = parseHybridPouFromString(content, 'python', 'function')
    expect(result.interface?.returnType).toBe('INT')
  })

  it('parses a function-block', () => {
    const content = `FUNCTION_BLOCK MyFB
pass
END_FUNCTION_BLOCK`

    const result = parseHybridPouFromString(content, 'python', 'function-block')
    expect(result.pouType).toBe('function-block')
  })

  it('handles programs with no variables', () => {
    const content = `PROGRAM NoVars
pass
END_PROGRAM`

    const result = parseHybridPouFromString(content, 'python', 'program')
    expect(result.interface?.variables).toEqual([])
  })

  it('reports a VAR block without END_VAR as a parse error on the VAR line', () => {
    const content = `PROGRAM Main
VAR x : INT;
code here
END_PROGRAM`
    expect(() => parseHybridPouFromString(content, 'python', 'program')).toThrow(/Parse error on line 2: .*END_VAR/)
  })

  // -------------------------------------------------------------------------
  // Error cases
  // -------------------------------------------------------------------------
  it('throws for unsupported POU type', () => {
    const content = 'PROGRAM Main\nEND_PROGRAM'
    expect(() => parseHybridPouFromString(content, 'python', 'unknown')).toThrow('Unsupported POU type')
  })

  it('throws when declaration is not found', () => {
    const content = 'print("hello")\nEND_PROGRAM'
    expect(() => parseHybridPouFromString(content, 'python', 'program')).toThrow('Could not find PROGRAM declaration')
  })

  it('throws when function has no return type', () => {
    const content = 'FUNCTION NoReturn\npass\nEND_FUNCTION'
    expect(() => parseHybridPouFromString(content, 'python', 'function')).toThrow('must have a return type')
  })
})

// ---------------------------------------------------------------------------
// parseGraphicalPouFromString
// ---------------------------------------------------------------------------
describe('parseGraphicalPouFromString', () => {
  it('parses an LD program with JSON body', () => {
    const bodyValue = { rungs: [{ id: '1', nodes: [], edges: [] }] }
    const content = `PROGRAM LdMain
VAR
  x : INT;
END_VAR

${JSON.stringify(bodyValue, null, 2)}
END_PROGRAM`

    const result = parseGraphicalPouFromString(content, 'ld', 'program')
    expect(result.name).toBe('LdMain')
    expect(result.pouType).toBe('program')
    expect(result.body.language).toBe('ld')
    expect(result.body.value).toEqual(bodyValue)
  })

  it('parses an FBD program', () => {
    const bodyValue = { name: 'FbdMain', rung: { nodes: [{ id: '1' }], edges: [] } }
    const content = `PROGRAM FbdMain
${JSON.stringify(bodyValue, null, 2)}
END_PROGRAM`

    const result = parseGraphicalPouFromString(content, 'fbd', 'program')
    expect(result.body.language).toBe('fbd')
    expect(result.body.value).toEqual(bodyValue)
  })

  it('parses documentation', () => {
    const content = `(* Graphical doc *)

PROGRAM GfxPou
{ "rungs": [] }
END_PROGRAM`

    const result = parseGraphicalPouFromString(content, 'ld', 'program')
    expect(result.documentation).toBe('Graphical doc')
  })

  it('parses a function with return type', () => {
    const content = `FUNCTION GfxFunc : BOOL
{ "rungs": [] }
END_FUNCTION`

    const result = parseGraphicalPouFromString(content, 'ld', 'function')
    expect(result.interface?.returnType).toBe('BOOL')
  })

  it('parses a function-block', () => {
    const content = `FUNCTION_BLOCK GfxFB
{ "rungs": [] }
END_FUNCTION_BLOCK`

    const result = parseGraphicalPouFromString(content, 'ld', 'function-block')
    expect(result.pouType).toBe('function-block')
  })

  it('parses with multiple variable blocks', () => {
    const content = `PROGRAM Multi
VAR_INPUT
  a : INT;
END_VAR
VAR_OUTPUT
  b : INT;
END_VAR

{ "rungs": [] }
END_PROGRAM`

    const result = parseGraphicalPouFromString(content, 'ld', 'program')
    expect(result.interface?.variables.length).toBe(2)
  })

  it('reports a VAR block without END_VAR as a parse error on the VAR line, not as invalid JSON', () => {
    const content = `PROGRAM Main
VAR x : INT;
{}
END_PROGRAM`
    const message = messageOf(() => parseGraphicalPouFromString(content, 'ld', 'program'))
    expect(message).toMatch(/Parse error on line 2: .*END_VAR/)
    expect(message).not.toContain('Invalid JSON')
  })

  // -------------------------------------------------------------------------
  // Error cases
  // -------------------------------------------------------------------------
  it('throws for unsupported POU type', () => {
    const content = 'PROGRAM Main\n{}\nEND_PROGRAM'
    expect(() => parseGraphicalPouFromString(content, 'ld', 'unknown')).toThrow('Unsupported POU type')
  })

  it('throws when declaration is not found', () => {
    const content = '{}\nEND_PROGRAM'
    expect(() => parseGraphicalPouFromString(content, 'ld', 'program')).toThrow('Could not find PROGRAM declaration')
  })

  it('throws when function has no return type', () => {
    const content = 'FUNCTION NoReturn\n{}\nEND_FUNCTION'
    expect(() => parseGraphicalPouFromString(content, 'ld', 'function')).toThrow('must have a return type')
  })

  it('throws when end keyword is missing', () => {
    const content = 'PROGRAM Main\nVAR\n  x : INT;\nEND_VAR\n{}'
    expect(() => parseGraphicalPouFromString(content, 'ld', 'program')).toThrow('Could not find END_PROGRAM')
  })

  it('throws for invalid JSON in body', () => {
    const content = `PROGRAM Main
not-json
END_PROGRAM`
    expect(() => parseGraphicalPouFromString(content, 'ld', 'program')).toThrow('Invalid JSON in graphical body')
  })

  it('wraps non-Error JSON parse failures', () => {
    // This tests the catch branch for non-Error objects in JSON.parse.
    // Since standard JSON.parse always throws Error, we test the outer catch
    // branch by checking that the generic "Invalid JSON" message is in the chain.
    const content = `PROGRAM Main
{invalid
END_PROGRAM`
    expect(() => parseGraphicalPouFromString(content, 'ld', 'program')).toThrow('Invalid JSON')
  })
})

// ---------------------------------------------------------------------------
// parseTextualPouFromString — non-Error throw (line 148)
// ---------------------------------------------------------------------------
describe('parseTextualPouFromString — non-Error throw branch', () => {
  it('throws generic Unknown error when a non-Error object is thrown internally', () => {
    const spy = vi.spyOn(iecStringModule, 'parseIecStringToVariables').mockImplementation(() => {
      // eslint-disable-next-line no-throw-literal
      throw 'non-error string'
    })

    const content = `PROGRAM Main
VAR
  x : INT;
END_VAR

x := 1;

END_PROGRAM`

    expect(() => parseTextualPouFromString(content, 'st', 'program')).toThrow('Unknown error')
    spy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// parseHybridPouFromString — non-Error throw (line 240)
// ---------------------------------------------------------------------------
describe('parseHybridPouFromString — non-Error throw branch', () => {
  it('throws generic Unknown error when a non-Error object is thrown internally', () => {
    const spy = vi.spyOn(iecStringModule, 'parseIecStringToVariables').mockImplementation(() => {
      // eslint-disable-next-line no-throw-literal
      throw 42
    })

    const content = `PROGRAM Main
VAR
  x : INT;
END_VAR
print("hello")
END_PROGRAM`

    expect(() => parseHybridPouFromString(content, 'python', 'program')).toThrow('Unknown error')
    spy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// parseGraphicalPouFromString — non-Error JSON parse (line 326) and outer catch (line 346)
// ---------------------------------------------------------------------------
describe('parseGraphicalPouFromString — non-Error throw branches', () => {
  it('throws generic Unknown error for non-Error JSON parse failure (line 326)', () => {
    const originalParse = JSON.parse
    JSON.parse = () => {
      // eslint-disable-next-line no-throw-literal
      throw 'non-error-json'
    }

    try {
      const content = `PROGRAM Main
{}
END_PROGRAM`
      expect(() => parseGraphicalPouFromString(content, 'ld', 'program')).toThrow('Invalid JSON in graphical body')
    } finally {
      JSON.parse = originalParse
    }
  })

  it('throws generic Unknown error when outer catch receives non-Error (line 346)', () => {
    const spy = vi.spyOn(iecStringModule, 'parseIecStringToVariables').mockImplementation(() => {
      // eslint-disable-next-line no-throw-literal
      throw { weird: true }
    })

    const content = `PROGRAM GfxMain
VAR
  x : INT;
END_VAR
{}
END_PROGRAM`

    expect(() => parseGraphicalPouFromString(content, 'ld', 'program')).toThrow('Unknown error')
    spy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// detectLanguageFromExtension
// ---------------------------------------------------------------------------
describe('detectLanguageFromExtension', () => {
  it('detects ST from .st file path', () => {
    expect(detectLanguageFromExtension('/path/to/file.st')).toBe('st')
  })

  it('detects IL from .il file path', () => {
    expect(detectLanguageFromExtension('/path/to/file.il')).toBe('il')
  })

  it('detects LD from .ld file path', () => {
    expect(detectLanguageFromExtension('file.ld')).toBe('ld')
  })

  it('detects FBD from .fbd file path', () => {
    expect(detectLanguageFromExtension('file.fbd')).toBe('fbd')
  })

  it('detects Python from .py file path', () => {
    expect(detectLanguageFromExtension('file.py')).toBe('python')
  })

  it('detects C++ from .cpp file path', () => {
    expect(detectLanguageFromExtension('file.cpp')).toBe('cpp')
  })

  it('throws for unsupported extension', () => {
    expect(() => detectLanguageFromExtension('file.java')).toThrow('Unsupported extension')
  })
})

// ---------------------------------------------------------------------------
// DOPE-592: a placed native library block carries its own VAR ... END_VAR
// ---------------------------------------------------------------------------
describe('graphical POU holding a native library block', () => {
  // A C++ library block's authored source, as `node.data.variant.body` used to
  // carry it. Two details matter and both are what shipped in real projects:
  // END_VAR is indented (so a space precedes it and the \bEND_VAR\b word
  // boundary matches, which an escaped newline alone would have blocked), and
  // the body continues past it with content that is not JSON.
  const nativeBlockSource = [
    'FUNCTION_BLOCK TCP_CLIENT',
    'VAR_INPUT',
    '  EN : BOOL;',
    '  END_VAR',
    'VAR',
    '  fd : INT;',
    '  END_VAR',
    '#ifdef ARDUINO',
    '#include <WiFi.h>',
    '#endif',
  ].join('\n')

  const body = {
    name: 'main',
    rungs: [
      {
        id: 'rung-1',
        nodes: [
          {
            id: 'block-1',
            type: 'block',
            data: { variant: { name: 'TCP_CLIENT', language: 'cpp', body: nativeBlockSource } },
          },
        ],
        edges: [],
      },
    ],
  }

  const content = `PROGRAM main\nVAR\n  x : BOOL;\nEND_VAR\n\n${JSON.stringify(body, null, 2)}\nEND_PROGRAM\n`

  it('parses the body instead of slicing it from the embedded END_VAR', () => {
    const pou = parseGraphicalPouFromString(content, 'ld', 'program')
    expect(pou.body.value).toMatchObject({
      rungs: [{ nodes: [{ data: { variant: { name: 'TCP_CLIENT' } } }] }],
    })
  })

  it("still reads the POU's own variables, not the block's", () => {
    const pou = parseGraphicalPouFromString(content, 'ld', 'program')
    expect(pou.interface?.variables.map((v) => v.name)).toEqual(['x'])
  })
})

// ---------------------------------------------------------------------------
// DOPE-592: a wrong shape is not a JSON error
// ---------------------------------------------------------------------------
describe('graphical body diagnostics', () => {
  const wrap = (body: string) => `PROGRAM main\nVAR\nEND_VAR\n\n${body}\nEND_PROGRAM\n`

  const messageFor = (body: string, language: 'ld' | 'fbd' = 'ld'): string => {
    try {
      parseGraphicalPouFromString(wrap(body), language, 'program')
    } catch (error) {
      return (error as Error).message
    }
    return 'PARSED OK'
  }

  it('reports malformed JSON as a JSON error', () => {
    const message = messageFor('{ not json')
    expect(message).toContain('Invalid JSON in graphical body')
    expect(message).not.toContain('Invalid graphical body shape')
  })

  it('reports valid JSON of the wrong shape as a SHAPE error, not a JSON one', () => {
    // Saying "Invalid JSON" about valid JSON sends the reader hunting for a
    // syntax error that does not exist. On an unrecoverable POU this text is
    // the Console line explaining why the project opened empty.
    const message = messageFor('{ "nodes": [], "edges": [] }')
    expect(message).toContain('Invalid graphical body shape')
    expect(message).toContain('"rungs" array')
    expect(message).not.toContain('Invalid JSON')
  })

  it('names the FBD container when an FBD body has the wrong shape', () => {
    const message = messageFor('{ "rungs": [] }', 'fbd')
    expect(message).toContain('Invalid graphical body shape')
    expect(message).toContain('"rung" object holding a "nodes" array')
  })
})

// ---------------------------------------------------------------------------
// findGraphicalBodyStartIndex
// ---------------------------------------------------------------------------
describe('findGraphicalBodyStartIndex', () => {
  it('finds the brace that opens the body in column 0', () => {
    const content = 'VAR\n  x : BOOL;\nEND_VAR\n\n{\n  "name": "main"\n}\n'
    expect(findGraphicalBodyStartIndex(content, 0)).toBe(content.indexOf('{'))
  })

  it('ignores a brace inside a declaration line', () => {
    // Only a line-initial brace opens a body, so an initial value or an inline
    // comment carrying one cannot cut the declaration scan short.
    const content = 'VAR\n  x : STRING := \'{}\'; (* {shape} *)\nEND_VAR\n\n{\n  "name": "m"\n}\n'
    expect(findGraphicalBodyStartIndex(content, 0)).toBe(content.indexOf('\n{\n') + 1)
  })

  it('returns -1 when there is no body', () => {
    expect(findGraphicalBodyStartIndex('VAR\n  x : BOOL;\nEND_VAR\n', 0)).toBe(-1)
  })
})

// ---------------------------------------------------------------------------
// findLastEndVarIndex bound
// ---------------------------------------------------------------------------
describe('findLastEndVarIndex with an upper bound', () => {
  it('ignores an END_VAR at or past the bound', () => {
    const content = 'VAR x : INT; END_VAR\n{ "s": "VAR y; END_VAR" }'
    const bound = content.indexOf('{')
    expect(findLastEndVarIndex(content, 0, bound)).toBe(content.indexOf('END_VAR') + 'END_VAR'.length)
  })

  it('returns -1 when the bound excludes every END_VAR', () => {
    const content = 'VAR x : INT; END_VAR'
    expect(findLastEndVarIndex(content, 0, 5)).toBe(-1)
  })
})

/**
 * What counts as the declarations, when the POU header shares their line.
 *
 * The section runs from the start of the VAR line so the user's indentation
 * survives the round trip — but a file written `PROGRAM main VAR` on one line
 * put the header inside the declarations. The POU then failed to parse, opened
 * as an unparsed fallback, and the next save wrote its header twice.
 */
describe('extractVariablesSection and the POU header', () => {
  const textOf = (content: string) => parseTextualPouFromString(content, 'st', 'program')

  it('leaves a header sharing the VAR line out of the declarations', () => {
    const pou = textOf('PROGRAM main VAR\n  a : INT;\nEND_VAR\n  a := 1;\nEND_PROGRAM\n')

    expect(pou.variablesText).toBe('VAR\n  a : INT;\nEND_VAR')
    expect(pou.interface?.variables.map((variable) => variable.name)).toEqual(['a'])
  })

  it('keeps the indentation when the VAR line holds only indentation', () => {
    const pou = textOf('PROGRAM main\n    VAR\n      a : INT;\n    END_VAR\n  a := 1;\nEND_PROGRAM\n')

    expect(pou.variablesText).toBe('    VAR\n      a : INT;\n    END_VAR')
  })

  it('reads a whole POU written on one line', () => {
    const pou = textOf('PROGRAM main VAR a : INT; END_VAR a := 1; END_PROGRAM\n')

    expect(pou.variablesText).toBe('VAR a : INT; END_VAR')
    expect(pou.interface?.variables.map((variable) => variable.name)).toEqual(['a'])
  })
})

/** Options accepted by `extractVariablesSection`. */
type SectionOptions = { boundAtGraphicalBody?: boolean; endKeyword?: string }

/** The declaration section of `content`, scanned from the end of its POU header. */
const sectionOf = (content: string, pouType: string, options: SectionOptions = {}): unknown => {
  const header = matchPouHeader(content, pouType)
  if (!header) throw new Error(`no ${pouType} header in fixture`)
  return extractVariablesSection(content, header.text.length, options)
}

describe('extractVariablesSection kinds', () => {
  it('reports a VAR block that never reaches END_VAR as unterminated, ending before the last END_PROGRAM', () => {
    const content = 'PROGRAM main\nVAR\n  a : INT;\n\na := 1;\nEND_PROGRAM\n'

    expect(sectionOf(content, 'program', { endKeyword: 'END_PROGRAM' })).toEqual({
      kind: 'unterminated',
      text: 'VAR\n  a : INT;\n\na := 1;',
      bodyStartIndex: content.lastIndexOf('END_PROGRAM'),
      line: 2,
    })
  })

  it.each([
    [
      'a VAR block on its own line',
      'PROGRAM main\nVAR\n  a : INT;\nEND_VAR\n\na := 1;\nEND_PROGRAM\n',
      'VAR\n  a : INT;\nEND_VAR',
    ],
    [
      'an indented VAR block',
      'PROGRAM main\n    VAR\n      a : INT;\n    END_VAR\n  a := 1;\nEND_PROGRAM\n',
      '    VAR\n      a : INT;\n    END_VAR',
    ],
    [
      'a header sharing the VAR line',
      'PROGRAM main VAR\n  a : INT;\nEND_VAR\n  a := 1;\nEND_PROGRAM\n',
      'VAR\n  a : INT;\nEND_VAR',
    ],
    ['a POU on one line', 'PROGRAM main VAR a : INT; END_VAR a := 1; END_PROGRAM\n', 'VAR a : INT; END_VAR'],
    [
      'two blocks',
      'PROGRAM main\nVAR_INPUT\n  a : INT;\nEND_VAR\nVAR_OUTPUT\n  b : INT;\nEND_VAR\n\nb := a;\nEND_PROGRAM\n',
      'VAR_INPUT\n  a : INT;\nEND_VAR\nVAR_OUTPUT\n  b : INT;\nEND_VAR',
    ],
  ])('keeps %s declared, from the VAR line to the last END_VAR', (_label, content, text) => {
    expect(sectionOf(content, 'program', { endKeyword: 'END_PROGRAM' })).toEqual({
      kind: 'declared',
      text,
      bodyStartIndex: content.lastIndexOf('END_VAR') + 'END_VAR'.length,
    })
  })

  it('reports a POU with no VAR keyword as none, with the body starting after the header', () => {
    expect(sectionOf('PROGRAM main\n\na := 1;\nEND_PROGRAM\n', 'program', { endKeyword: 'END_PROGRAM' })).toEqual({
      kind: 'none',
      text: '',
      bodyStartIndex: 'PROGRAM main'.length,
    })
  })

  it.each([
    ['block', 'PROGRAM p\n(* uses VAR x *)\nx := 1;\nEND_PROGRAM'],
    ['line', 'PROGRAM p\n// VAR is not declared here\nx := 1;\nEND_PROGRAM'],
  ])('reports a body-only POU whose %s comment holds the word VAR as none', (_label, content) => {
    expect(sectionOf(content, 'program', { endKeyword: 'END_PROGRAM' })).toEqual({
      kind: 'none',
      text: '',
      bodyStartIndex: 'PROGRAM p'.length,
    })
  })

  it('keeps comments between the header and an unterminated VAR, and reports the VAR line', () => {
    const content = 'PROGRAM main\n(* locals *)\n// counters\nVAR\n  a : INT;\na := 1;\nEND_PROGRAM\n'

    expect(sectionOf(content, 'program', { endKeyword: 'END_PROGRAM' })).toEqual({
      kind: 'unterminated',
      text: '(* locals *)\n// counters\nVAR\n  a : INT;\na := 1;',
      bodyStartIndex: content.lastIndexOf('END_PROGRAM'),
      line: 4,
    })
  })

  it('keeps the indentation of a comment that opens an unterminated declaration section', () => {
    const content = 'PROGRAM main\n  (* locals *)\n  VAR\n    a : INT;\nEND_PROGRAM\n'

    expect(sectionOf(content, 'program', { endKeyword: 'END_PROGRAM' })).toEqual({
      kind: 'unterminated',
      text: '  (* locals *)\n  VAR\n    a : INT;',
      bodyStartIndex: content.lastIndexOf('END_PROGRAM'),
      line: 3,
    })
  })

  it.each(['VAR', 'VAR_INPUT', 'VAR_OUTPUT', 'VAR_IN_OUT', 'VAR_EXTERNAL', 'VAR_TEMP', 'VAR_GLOBAL'])(
    'reports an unterminated %s block',
    (keyword) => {
      const content = `FUNCTION_BLOCK fb\n${keyword}\n  a : INT;\nEND_FUNCTION_BLOCK\n`

      expect(sectionOf(content, 'function-block', { endKeyword: 'END_FUNCTION_BLOCK' })).toEqual({
        kind: 'unterminated',
        text: `${keyword}\n  a : INT;`,
        bodyStartIndex: content.lastIndexOf('END_FUNCTION_BLOCK'),
        line: 2,
      })
    },
  )

  it('keeps the indentation of an unterminated VAR line', () => {
    const content = 'PROGRAM main\n    VAR\n      a : INT;\n  a := 1;\nEND_PROGRAM\n'

    expect(sectionOf(content, 'program', { endKeyword: 'END_PROGRAM' })).toEqual({
      kind: 'unterminated',
      text: '    VAR\n      a : INT;\n  a := 1;',
      bodyStartIndex: content.lastIndexOf('END_PROGRAM'),
      line: 2,
    })
  })

  it('leaves a header sharing an unterminated VAR line out of the text', () => {
    const content = 'PROGRAM main VAR\n  a : INT;\nEND_PROGRAM\n'

    expect(sectionOf(content, 'program', { endKeyword: 'END_PROGRAM' })).toEqual({
      kind: 'unterminated',
      text: 'VAR\n  a : INT;',
      bodyStartIndex: content.lastIndexOf('END_PROGRAM'),
      line: 1,
    })
  })

  it('ends an unterminated FUNCTION block before END_FUNCTION', () => {
    const content = 'FUNCTION f : INT\nVAR_INPUT\n  a : INT;\nf := a;\nEND_FUNCTION\n'

    expect(sectionOf(content, 'function', { endKeyword: 'END_FUNCTION' })).toEqual({
      kind: 'unterminated',
      text: 'VAR_INPUT\n  a : INT;\nf := a;',
      bodyStartIndex: content.lastIndexOf('END_FUNCTION'),
      line: 2,
    })
  })

  it('ends an unterminated block at the last occurrence of the end keyword', () => {
    const content = 'PROGRAM main\nVAR\n  a : INT; (* see END_PROGRAM *)\nEND_PROGRAM\n'

    expect(sectionOf(content, 'program', { endKeyword: 'END_PROGRAM' })).toEqual({
      kind: 'unterminated',
      text: 'VAR\n  a : INT; (* see END_PROGRAM *)',
      bodyStartIndex: content.lastIndexOf('END_PROGRAM'),
      line: 2,
    })
  })

  it('matches the end keyword case-insensitively', () => {
    const content = 'PROGRAM main\nVAR\n  a : INT;\nend_program\n'

    expect(sectionOf(content, 'program', { endKeyword: 'END_PROGRAM' })).toEqual({
      kind: 'unterminated',
      text: 'VAR\n  a : INT;',
      bodyStartIndex: content.indexOf('end_program'),
      line: 2,
    })
  })

  it('runs an unterminated block to the end of the content when nothing bounds it', () => {
    const content = 'PROGRAM main\nVAR\n  a : INT;\n\n'

    expect(sectionOf(content, 'program')).toEqual({
      kind: 'unterminated',
      text: 'VAR\n  a : INT;',
      bodyStartIndex: content.length,
      line: 2,
    })
  })

  it('stops an unterminated graphical block at the start of the JSON body', () => {
    const content = 'PROGRAM main\nVAR\n  a : BOOL;\n\n{\n  "rungs": []\n}\nEND_PROGRAM\n'

    expect(sectionOf(content, 'program', { boundAtGraphicalBody: true })).toEqual({
      kind: 'unterminated',
      text: 'VAR\n  a : BOOL;',
      bodyStartIndex: content.indexOf('\n{\n') + 1,
      line: 2,
    })
  })

  it('ignores an END_VAR inside the JSON body of a graphical POU', () => {
    const content =
      'PROGRAM main\nVAR\n  a : BOOL;\n\n{\n  "rungs": [{ "src": "VAR x : INT; END_VAR" }]\n}\nEND_PROGRAM\n'

    expect(sectionOf(content, 'program', { boundAtGraphicalBody: true })).toEqual({
      kind: 'unterminated',
      text: 'VAR\n  a : BOOL;',
      bodyStartIndex: content.indexOf('\n{\n') + 1,
      line: 2,
    })
  })

  it('runs an unterminated graphical block to the end of the content when there is no JSON body', () => {
    const content = 'PROGRAM main\nVAR\n  a : BOOL;\n'

    expect(sectionOf(content, 'program', { boundAtGraphicalBody: true })).toEqual({
      kind: 'unterminated',
      text: 'VAR\n  a : BOOL;',
      bodyStartIndex: content.length,
      line: 2,
    })
  })
})

describe('a VAR block without END_VAR is a parse error', () => {
  it('wraps the line-numbered error in the textual parser message', () => {
    const content = 'PROGRAM main\nVAR\n  a : INT;\na := 1;\nEND_PROGRAM\n'

    expect(() => parseTextualPouFromString(content, 'st', 'program')).toThrow(
      'Failed to parse textual POU: Parse error on line 2: ',
    )
  })

  it('counts the lines of the leading documentation in the reported line', () => {
    const content = '(* Doc *)\n\nPROGRAM main\nVAR\n  a : INT;\nEND_PROGRAM\n'

    expect(() => parseTextualPouFromString(content, 'st', 'program')).toThrow(/Parse error on line 4: .*END_VAR/)
  })

  it('reports the VAR line after comments that precede it', () => {
    const content = 'PROGRAM main\n(* locals *)\n// counters\nVAR\n  a : INT;\na := 1;\nEND_PROGRAM\n'

    expect(() => parseTextualPouFromString(content, 'st', 'program')).toThrow(/Parse error on line 4: .*END_VAR/)
  })

  it('reports an unterminated block in a FUNCTION', () => {
    const content = 'FUNCTION f : INT\nVAR_INPUT\n  a : INT;\nf := a;\nEND_FUNCTION\n'

    expect(() => parseTextualPouFromString(content, 'st', 'function')).toThrow(/Parse error on line 2: .*END_VAR/)
  })

  it('reports an unterminated block in a FUNCTION_BLOCK', () => {
    const content = 'FUNCTION_BLOCK fb\nVAR\n  a : INT;\nEND_FUNCTION_BLOCK\n'

    expect(() => parseTextualPouFromString(content, 'il', 'function-block')).toThrow(/Parse error on line 2: .*END_VAR/)
  })

  it('reports an unterminated block in a C++ POU', () => {
    const content = 'PROGRAM main\nVAR\n  a : INT;\nvoid loop() {}\nEND_PROGRAM\n'

    expect(() => parseHybridPouFromString(content, 'cpp', 'program')).toThrow(
      /Failed to parse hybrid POU: Parse error on line 2: .*END_VAR/,
    )
  })

  it('reports an unterminated block in an FBD POU whose JSON body is valid', () => {
    const content =
      'PROGRAM main\nVAR\n  a : BOOL;\n\n{\n  "name": "main",\n  "rung": { "nodes": [] }\n}\nEND_PROGRAM\n'

    expect(() => parseGraphicalPouFromString(content, 'fbd', 'program')).toThrow(
      /Failed to parse graphical POU: Parse error on line 2: .*END_VAR/,
    )
  })

  it('reports an unterminated block in an LD POU whose JSON body carries its own END_VAR', () => {
    const content =
      'PROGRAM main\nVAR\n  a : BOOL;\n\n{\n  "rungs": [{ "src": "VAR x : INT; END_VAR" }]\n}\nEND_PROGRAM\n'

    expect(() => parseGraphicalPouFromString(content, 'ld', 'program')).toThrow(/Parse error on line 2: .*END_VAR/)
  })

  it('still parses a body-only POU whose comment holds the word VAR', () => {
    const pou = parseTextualPouFromString('PROGRAM p\n(* uses VAR x *)\nx := 1;\nEND_PROGRAM', 'st', 'program')

    expect(pou.interface?.variables).toEqual([])
    expect(pou.body.value).toBe('(* uses VAR x *)\nx := 1;')
  })
})
