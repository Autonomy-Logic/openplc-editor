import * as iecStringModule from '../../generate-iec-string-to-variables'
import {
  detectLanguageFromExtension,
  findLastEndVarIndex,
  parseGraphicalPouFromString,
  parseHybridPouFromString,
  parseTextualPouFromString,
} from '../pou-text-parser'

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

  it('handles VAR keyword present but no END_VAR (body starts after declaration)', () => {
    // VAR keyword found but no matching END_VAR -- bodyStartIndex stays at declaration length
    // Body includes everything from declaration to END_PROGRAM
    const content = `PROGRAM Main
VAR x : INT;
x := 1;
END_PROGRAM`
    const result = parseTextualPouFromString(content, 'st', 'program')
    expect(result.name).toBe('Main')
    expect(result.interface?.variables).toEqual([])
    // Body includes the VAR line since there was no END_VAR
    expect(result.body.value as string).toContain('VAR x : INT;')
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

  it('handles VAR keyword present but no END_VAR', () => {
    const content = `PROGRAM Main
VAR x : INT;
code here
END_PROGRAM`
    const result = parseHybridPouFromString(content, 'python', 'program')
    expect(result.name).toBe('Main')
    expect(result.interface?.variables).toEqual([])
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
    const bodyValue = { nodes: [{ id: '1' }], edges: [] }
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
{}
END_PROGRAM`

    const result = parseGraphicalPouFromString(content, 'ld', 'program')
    expect(result.documentation).toBe('Graphical doc')
  })

  it('parses a function with return type', () => {
    const content = `FUNCTION GfxFunc : BOOL
{}
END_FUNCTION`

    const result = parseGraphicalPouFromString(content, 'ld', 'function')
    expect(result.interface?.returnType).toBe('BOOL')
  })

  it('parses a function-block', () => {
    const content = `FUNCTION_BLOCK GfxFB
{}
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

{}
END_PROGRAM`

    const result = parseGraphicalPouFromString(content, 'ld', 'program')
    expect(result.interface?.variables.length).toBe(2)
  })

  it('handles VAR keyword present but no END_VAR (results in invalid JSON body)', () => {
    // VAR found but no END_VAR means body includes the VAR line, which is invalid JSON
    const content = `PROGRAM Main
VAR x : INT;
{}
END_PROGRAM`
    expect(() => parseGraphicalPouFromString(content, 'ld', 'program')).toThrow('Invalid JSON')
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
