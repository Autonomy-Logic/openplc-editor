import type { StlibArchiveDTO } from '../../../middleware/shared/ports/library-port'
import { stlibsToSystemLibraries, stlibToSystemLibrary } from '../stlib-to-system-library'

function makeArchive(overrides: Partial<StlibArchiveDTO['manifest']> = {}): StlibArchiveDTO {
  return {
    manifest: {
      name: 'test',
      version: '1.0.0',
      namespace: 'test',
      isBuiltin: false,
      functions: [],
      functionBlocks: [],
      types: [],
      ...overrides,
    },
  }
}

describe('stlibToSystemLibrary — functions', () => {
  it('synthesises an OUT pin from the returnType so blocks render uniformly', () => {
    const lib = stlibToSystemLibrary(
      makeArchive({
        functions: [
          {
            name: 'ADD',
            returnType: 'INT',
            parameters: [
              { name: 'a', type: 'INT', direction: 'input' },
              { name: 'b', type: 'INT', direction: 'input' },
            ],
          },
        ],
      }),
    )

    expect(lib.pous).toHaveLength(1)
    const fn = lib.pous[0]
    expect(fn.type).toBe('function')
    expect(fn.variables).toHaveLength(3)
    expect(fn.variables[2]).toEqual({ name: 'OUT', class: 'output', type: { definition: 'base-type', value: 'INT' } })
    expect(fn.extensible).toBe(false)
  })

  it('flags variadic functions as extensible', () => {
    const lib = stlibToSystemLibrary(
      makeArchive({
        functions: [
          {
            name: 'AND',
            returnType: 'BOOL',
            parameters: [{ name: 'a', type: 'BOOL', direction: 'input' }],
            variadic: { minArgs: 2 },
          },
        ],
      }),
    )

    expect(lib.pous[0].extensible).toBe(true)
  })

  it('encodes generic types with definition=generic-type', () => {
    const lib = stlibToSystemLibrary(
      makeArchive({
        functions: [
          {
            name: 'MUX',
            returnType: 'ANY',
            parameters: [{ name: 'k', type: 'INT', direction: 'input' }],
          },
        ],
      }),
    )

    expect(lib.pous[0].variables[1].type).toEqual({ definition: 'generic-type', value: 'ANY' })
  })

  it('falls back to derived-type for unknown type names', () => {
    const lib = stlibToSystemLibrary(
      makeArchive({
        functions: [
          {
            name: 'fn',
            returnType: 'MY_STRUCT',
            parameters: [],
          },
        ],
      }),
    )

    expect(lib.pous[0].variables[0]).toEqual({
      name: 'OUT',
      class: 'output',
      type: { definition: 'derived-type', value: 'MY_STRUCT' },
    })
  })
})

describe('stlibToSystemLibrary — function blocks', () => {
  it('maps inputs/outputs/inouts to the editor variable classes', () => {
    const lib = stlibToSystemLibrary(
      makeArchive({
        functionBlocks: [
          {
            name: 'TANK',
            inputs: [{ name: 'level', type: 'REAL' }],
            outputs: [{ name: 'ready', type: 'BOOL' }],
            inouts: [{ name: 'cfg', type: 'INT' }],
          },
        ],
      }),
    )

    const fb = lib.pous[0]
    expect(fb.type).toBe('function-block')
    expect(fb.variables.map((v) => v.class)).toEqual(['input', 'output', 'inOut'])
  })
})

describe('stlibToSystemLibrary — native (C/C++, Python) blocks', () => {
  const nativeArchive = (
    blocks: Array<{ name: string; implementation: 'cpp' | 'python'; sourceFile?: string; documentation?: string }>,
    sources: Array<{ fileName: string; source: string }>,
  ): StlibArchiveDTO =>
    ({
      manifest: {
        name: 'mylib',
        version: '1.0.0',
        namespace: 'mylib',
        isBuiltin: false,
        functions: [],
        functionBlocks: blocks.map((b) => ({
          name: b.name,
          inputs: [{ name: 'pin', type: 'INT' }],
          outputs: [{ name: 'angle', type: 'INT' }],
          inouts: [{ name: 'state', type: 'BOOL' }],
          implementation: b.implementation,
          sourceFile: b.sourceFile ?? `${b.name}.${b.implementation === 'cpp' ? 'cpp' : 'py'}`,
          ...(b.documentation !== undefined ? { documentation: b.documentation } : {}),
        })),
        types: [],
      },
      sources,
    }) as unknown as StlibArchiveDTO

  it('surfaces a C++ block under its own name, with its authored source as the body', () => {
    const lib = stlibToSystemLibrary(
      nativeArchive(
        [{ name: 'Servo', implementation: 'cpp', documentation: 'A servo motor block' }],
        [{ fileName: 'Servo.cpp', source: 'void setup(){}void loop(){}' }],
      ),
    )

    expect(lib.pous).toHaveLength(1)
    const block = lib.pous[0]
    // One name across the whole system: the graft synthesizes a POU under
    // exactly this name and `resolveFunctionBlockPins` looks it up by it, so
    // a block inserted from the tree resolves its pins. No library prefix —
    // that namespace was private to the graft and broke both.
    expect(block.name).toBe('Servo')
    expect(block.type).toBe('function-block')
    expect(block.language).toBe('cpp')
    expect(block.body).toBe('void setup(){}void loop(){}')
    expect(block.documentation).toBe('A servo motor block')
    expect(block.variables.map((v) => v.class)).toEqual(['input', 'output', 'inOut'])
  })

  it('surfaces a Python block as a python POU', () => {
    const lib = stlibToSystemLibrary(
      nativeArchive(
        [{ name: 'Scale', implementation: 'python' }],
        [{ fileName: 'Scale.py', source: 'def block_loop():\n    pass' }],
      ),
    )
    expect(lib.pous[0].name).toBe('Scale')
    expect(lib.pous[0].language).toBe('python')
    expect(lib.pous[0].body).toBe('def block_loop():\n    pass')
  })

  it('resolves the body via sourceFile rather than guessing from the block name', () => {
    const lib = stlibToSystemLibrary(
      nativeArchive(
        [{ name: 'Block', implementation: 'cpp', sourceFile: 'renamed.cpp' }],
        [{ fileName: 'renamed.cpp', source: 'void loop(){}' }],
      ),
    )
    expect(lib.pous[0].body).toBe('void loop(){}')
  })

  it('leaves the body empty when the archive has no matching source', () => {
    const lib = stlibToSystemLibrary(nativeArchive([{ name: 'Gone', implementation: 'cpp' }], []))
    expect(lib.pous[0].body).toBe('')
  })

  it('uses an empty documentation string when the block omits one', () => {
    const lib = stlibToSystemLibrary(
      nativeArchive([{ name: 'Bare', implementation: 'cpp' }], [{ fileName: 'Bare.cpp', source: 'x' }]),
    )
    expect(lib.pous[0].documentation).toBe('')
  })

  it('leaves ordinary ST blocks unprefixed and marked st', () => {
    const archive = {
      manifest: {
        name: 'mylib',
        version: '1.0.0',
        namespace: 'mylib',
        isBuiltin: false,
        functions: [],
        functionBlocks: [{ name: 'ST_ADD', inputs: [], outputs: [], inouts: [] }],
        types: [],
      },
    } as unknown as StlibArchiveDTO

    const lib = stlibToSystemLibrary(archive)
    expect(lib.pous[0].name).toBe('ST_ADD')
    expect(lib.pous[0].language).toBe('st')
    expect(lib.pous[0].body).toBe('')
  })
})

describe('stlibToSystemLibrary — manifest passthrough', () => {
  it('surfaces displayName when set', () => {
    const lib = stlibToSystemLibrary(makeArchive({ displayName: 'My Library' }))
    expect(lib.displayName).toBe('My Library')
  })

  it('omits displayName when manifest has none', () => {
    const lib = stlibToSystemLibrary(makeArchive())
    expect(lib.displayName).toBeUndefined()
  })
})

describe('stlibsToSystemLibraries', () => {
  it('maps each archive in the input list', () => {
    const libs = stlibsToSystemLibraries([makeArchive({ name: 'a' }), makeArchive({ name: 'b' })])
    expect(libs.map((l) => l.name)).toEqual(['a', 'b'])
  })

  it('returns an empty list for an empty input', () => {
    expect(stlibsToSystemLibraries([])).toEqual([])
  })
})
