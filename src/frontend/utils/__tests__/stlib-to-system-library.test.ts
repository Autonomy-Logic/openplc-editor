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

describe('stlibToSystemLibrary — cppBlocks branch', () => {
  it('surfaces each library cpp block under the prefixed name', () => {
    const archive: StlibArchiveDTO = {
      manifest: {
        name: 'mylib',
        version: '1.0.0',
        namespace: 'mylib',
        isBuiltin: false,
        functions: [],
        functionBlocks: [],
        types: [],
      },
      cppBlocks: [
        {
          name: 'Servo',
          code: 'void setup(){}void loop(){}',
          variables: [
            { name: 'pin', class: 'input', type: { value: 'INT' } },
            { name: 'angle', class: 'output', type: { value: 'INT' } },
            { name: 'state', class: 'inOut', type: { value: 'BOOL' } },
            { name: 'local', class: 'local', type: { value: 'INT' } },
          ],
          documentation: 'A servo motor block',
        },
      ],
    }

    const lib = stlibToSystemLibrary(archive)

    expect(lib.pous).toHaveLength(1)
    const block = lib.pous[0]
    expect(block.name).toBe('mylib__Servo')
    expect(block.type).toBe('function-block')
    expect(block.language).toBe('cpp')
    expect(block.body).toBe('void setup(){}void loop(){}')
    expect(block.documentation).toBe('A servo motor block')
    expect(block.variables.map((v) => v.class)).toEqual(['input', 'output', 'inOut'])
  })

  it('falls back to BOOL when a cpp block variable omits its type', () => {
    const archive: StlibArchiveDTO = {
      manifest: {
        name: 'mylib',
        version: '1.0.0',
        namespace: 'mylib',
        isBuiltin: false,
        functions: [],
        functionBlocks: [],
        types: [],
      },
      cppBlocks: [
        {
          name: 'Bare',
          code: '',
          variables: [{ name: 'x', class: 'input' }],
        },
      ],
    }

    const lib = stlibToSystemLibrary(archive)

    expect(lib.pous[0].variables[0].type).toEqual({ definition: 'base-type', value: 'BOOL' })
  })

  it('uses an empty documentation string when the cpp block omits one', () => {
    const archive: StlibArchiveDTO = {
      manifest: {
        name: 'mylib',
        version: '1.0.0',
        namespace: 'mylib',
        isBuiltin: false,
        functions: [],
        functionBlocks: [],
        types: [],
      },
      cppBlocks: [{ name: 'NoDoc', code: '', variables: [] }],
    }

    const lib = stlibToSystemLibrary(archive)

    expect(lib.pous[0].documentation).toBe('')
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
