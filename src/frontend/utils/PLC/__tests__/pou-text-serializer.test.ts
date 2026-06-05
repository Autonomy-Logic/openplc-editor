import type { PLCPou } from '../../../../middleware/shared/ports/types'
import {
  serializeGraphicalPouToString,
  serializeHybridPouToString,
  serializePouToText,
  serializeTextualPouToString,
} from '../pou-text-serializer'

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------
type SerializablePou = PLCPou & { variablesText?: string }

function makeStPou(overrides: Partial<SerializablePou> = {}): SerializablePou {
  return {
    name: 'Main',
    pouType: 'program',
    interface: {
      variables: [],
    },
    body: {
      language: 'st',
      value: 'x := 1;',
    },
    documentation: '',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// serializeTextualPouToString
// ---------------------------------------------------------------------------
describe('serializeTextualPouToString', () => {
  it('serializes a simple ST program', () => {
    const pou = makeStPou()
    const result = serializeTextualPouToString(pou)
    expect(result).toContain('PROGRAM Main')
    expect(result).toContain('x := 1;')
    expect(result).toContain('END_PROGRAM')
  })

  it('serializes an IL program', () => {
    const pou = makeStPou({ body: { language: 'il', value: 'LD x' } })
    const result = serializeTextualPouToString(pou)
    expect(result).toContain('PROGRAM Main')
    expect(result).toContain('LD x')
    expect(result).toContain('END_PROGRAM')
  })

  it('serializes a function with return type', () => {
    const pou = makeStPou({
      pouType: 'function',
      name: 'MyFunc',
      interface: { returnType: 'INT', variables: [] },
    })
    const result = serializeTextualPouToString(pou)
    expect(result).toContain('FUNCTION MyFunc : INT')
    expect(result).toContain('END_FUNCTION')
  })

  it('serializes a function-block', () => {
    const pou = makeStPou({ pouType: 'function-block', name: 'MyFB' })
    const result = serializeTextualPouToString(pou)
    expect(result).toContain('FUNCTION_BLOCK MyFB')
    expect(result).toContain('END_FUNCTION_BLOCK')
  })

  it('includes documentation when present', () => {
    const pou = makeStPou({ documentation: 'This is a doc' })
    const result = serializeTextualPouToString(pou)
    expect(result).toContain('(* This is a doc *)')
  })

  it('omits documentation when empty', () => {
    const pou = makeStPou({ documentation: '' })
    const result = serializeTextualPouToString(pou)
    expect(result).not.toContain('(*')
  })

  it('omits documentation when only whitespace', () => {
    const pou = makeStPou({ documentation: '   ' })
    const result = serializeTextualPouToString(pou)
    expect(result).not.toContain('(*')
  })

  it('omits documentation when undefined', () => {
    const pou = makeStPou({ documentation: undefined })
    const result = serializeTextualPouToString(pou)
    expect(result).not.toContain('(*')
  })

  it('uses variablesText when provided', () => {
    const pou = makeStPou({ variablesText: 'VAR\n  x : INT;\nEND_VAR' })
    const result = serializeTextualPouToString(pou)
    expect(result).toContain('VAR\n  x : INT;\nEND_VAR')
  })

  it('generates variable declarations from interface variables when no variablesText', () => {
    const pou = makeStPou({
      interface: {
        variables: [
          {
            name: 'x',
            class: 'local',
            type: { definition: 'base-type', value: 'INT' },
            location: '',
            documentation: '',
          },
        ],
      },
    })
    const result = serializeTextualPouToString(pou)
    expect(result).toContain('VAR')
    expect(result).toContain('x : INT')
    expect(result).toContain('END_VAR')
  })

  it('throws for unsupported language', () => {
    const pou = makeStPou({ body: { language: 'python', value: '' } })
    expect(() => serializeTextualPouToString(pou)).toThrow('only supports ST and IL')
  })

  it('handles missing interface (undefined)', () => {
    const pou = makeStPou({ interface: undefined })
    const result = serializeTextualPouToString(pou)
    expect(result).toContain('PROGRAM Main')
  })
})

// ---------------------------------------------------------------------------
// serializeHybridPouToString
// ---------------------------------------------------------------------------
describe('serializeHybridPouToString', () => {
  it('serializes a Python program', () => {
    const pou = makeStPou({
      body: { language: 'python', value: 'print("hello")' },
    })
    const result = serializeHybridPouToString(pou)
    expect(result).toContain('PROGRAM Main')
    expect(result).toContain('print("hello")')
    expect(result).toContain('END_PROGRAM')
  })

  it('serializes a C++ function-block', () => {
    const pou = makeStPou({
      pouType: 'function-block',
      name: 'CppFB',
      body: { language: 'cpp', value: 'void setup() {}' },
    })
    const result = serializeHybridPouToString(pou)
    expect(result).toContain('FUNCTION_BLOCK CppFB')
    expect(result).toContain('void setup() {}')
    expect(result).toContain('END_FUNCTION_BLOCK')
  })

  it('includes documentation', () => {
    const pou = makeStPou({
      body: { language: 'python', value: '' },
      documentation: 'Python POU',
    })
    const result = serializeHybridPouToString(pou)
    expect(result).toContain('(* Python POU *)')
  })

  it('serializes a function with return type', () => {
    const pou = makeStPou({
      pouType: 'function',
      name: 'PyFunc',
      interface: { returnType: 'BOOL', variables: [] },
      body: { language: 'python', value: 'return True' },
    })
    const result = serializeHybridPouToString(pou)
    expect(result).toContain('FUNCTION PyFunc : BOOL')
  })

  it('throws for unsupported language', () => {
    const pou = makeStPou({ body: { language: 'st', value: '' } })
    expect(() => serializeHybridPouToString(pou)).toThrow('only supports Python and C++')
  })

  it('uses variablesText when provided', () => {
    const pou = makeStPou({
      body: { language: 'python', value: '' },
      variablesText: 'VAR\n  y : BOOL;\nEND_VAR',
    })
    const result = serializeHybridPouToString(pou)
    expect(result).toContain('VAR\n  y : BOOL;\nEND_VAR')
  })
})

// ---------------------------------------------------------------------------
// serializeGraphicalPouToString
// ---------------------------------------------------------------------------
describe('serializeGraphicalPouToString', () => {
  it('serializes an LD program with JSON body', () => {
    const bodyValue = { rungs: [{ id: '1', nodes: [], edges: [] }] }
    const pou = makeStPou({
      body: { language: 'ld', value: bodyValue },
    })
    const result = serializeGraphicalPouToString(pou)
    expect(result).toContain('PROGRAM Main')
    expect(result).toContain(JSON.stringify(bodyValue, null, 2))
    expect(result).toContain('END_PROGRAM')
  })

  it('serializes an FBD program', () => {
    const bodyValue = { nodes: [], edges: [] }
    const pou = makeStPou({
      body: { language: 'fbd', value: bodyValue },
    })
    const result = serializeGraphicalPouToString(pou)
    expect(result).toContain('PROGRAM Main')
    expect(result).toContain('"nodes"')
    expect(result).toContain('END_PROGRAM')
  })

  it('includes documentation', () => {
    const pou = makeStPou({
      body: { language: 'ld', value: {} },
      documentation: 'LD doc',
    })
    const result = serializeGraphicalPouToString(pou)
    expect(result).toContain('(* LD doc *)')
  })

  it('throws for unsupported language', () => {
    const pou = makeStPou({ body: { language: 'st', value: '' } })
    expect(() => serializeGraphicalPouToString(pou)).toThrow('only supports LD and FBD')
  })
})

// ---------------------------------------------------------------------------
// serializePouToText
// ---------------------------------------------------------------------------
describe('serializePouToText', () => {
  it('dispatches ST to serializeTextualPouToString', () => {
    const pou = makeStPou()
    const result = serializePouToText(pou)
    expect(result).toContain('PROGRAM Main')
    expect(result).toContain('END_PROGRAM')
  })

  it('dispatches IL to serializeTextualPouToString', () => {
    const pou = makeStPou({ body: { language: 'il', value: 'LD x' } })
    const result = serializePouToText(pou)
    expect(result).toContain('PROGRAM Main')
  })

  it('dispatches Python to serializeHybridPouToString', () => {
    const pou = makeStPou({ body: { language: 'python', value: 'pass' } })
    const result = serializePouToText(pou)
    expect(result).toContain('PROGRAM Main')
    expect(result).toContain('pass')
  })

  it('dispatches C++ to serializeHybridPouToString', () => {
    const pou = makeStPou({ body: { language: 'cpp', value: 'int x;' } })
    const result = serializePouToText(pou)
    expect(result).toContain('PROGRAM Main')
  })

  it('dispatches LD to serializeGraphicalPouToString', () => {
    const pou = makeStPou({ body: { language: 'ld', value: {} } })
    const result = serializePouToText(pou)
    expect(result).toContain('PROGRAM Main')
    expect(result).toContain('END_PROGRAM')
  })

  it('dispatches FBD to serializeGraphicalPouToString', () => {
    const pou = makeStPou({ body: { language: 'fbd', value: {} } })
    const result = serializePouToText(pou)
    expect(result).toContain('PROGRAM Main')
  })

  it('throws for unsupported language', () => {
    const pou = makeStPou({ body: { language: 'sfc' as 'st', value: '' } })
    expect(() => serializePouToText(pou)).toThrow('Unsupported language')
  })
})
