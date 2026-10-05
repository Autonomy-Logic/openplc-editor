import type { SystemLibrary, UserLibrary } from '../../../../middleware/shared/ports/library-types'
import type { PLCPou } from '../../../../middleware/shared/ports/types'
import { buildBlockVariant } from '../block-variant'

// `node.data.variant` is the only durable record of a placed block's signature —
// the transpiler and the PLCopen exporter read it off the node rather than
// re-resolving the library. Anything wrong here is wrong in the project forever.

const systemLibraries = [
  {
    name: 'standard',
    version: '1.0.0',
    author: '',
    stPath: '',
    cPath: '',
    pous: [
      {
        name: 'TON',
        type: 'function-block',
        documentation: 'On-delay timer',
        extensible: true,
        language: 'st',
        body: 'FUNCTION_BLOCK TON ... END_FUNCTION_BLOCK',
        variables: [
          { name: 'IN', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
          { name: 'PT', class: 'input', type: { definition: 'base-type', value: 'TIME' } },
          { name: 'Q', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        ],
      },
      {
        name: 'CTU',
        type: 'function-block',
        language: 'st',
        body: '',
        variables: [],
      },
    ],
  },
] as unknown as SystemLibrary[]

const userLibraries = [{ name: 'Latch' }, { name: 'Scale' }, { name: 'Ghost' }] as unknown as UserLibrary[]

const pous = [
  {
    name: 'Latch',
    pouType: 'function-block',
    documentation: 'Set-dominant latch',
    interface: {
      variables: [
        { id: 'v1', name: 'S', class: 'input', type: { definition: 'base-type', value: 'bool' } },
        { id: 'v2', name: 'Q', class: 'output', type: { definition: 'base-type', value: 'bool' } },
      ],
    },
  },
  {
    name: 'Scale',
    pouType: 'function',
    interface: {
      returnType: 'real',
      variables: [{ id: 'v3', name: 'Raw', class: 'input', type: { definition: 'base-type', value: 'int' } }],
    },
  },
] as unknown as PLCPou[]

const build = (blockRef: string) => buildBlockVariant({ blockRef, systemLibraries, userLibraries, pous })

describe('buildBlockVariant — system library branch', () => {
  it('copies the signature', () => {
    const result = build('system/standard/TON')

    expect(result).toEqual({
      ok: true,
      variant: {
        name: 'TON',
        type: 'function-block',
        documentation: 'On-delay timer',
        extensible: true,
        variables: [
          { name: 'IN', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
          { name: 'PT', class: 'input', type: { definition: 'base-type', value: 'TIME' } },
          { name: 'Q', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        ],
      },
    })
  })

  it('never carries the library entry body or language', () => {
    // DOPE-592: spreading the entry froze a copy of the library's source into
    // every project that placed the block, and the embedded VAR…END_VAR broke
    // the POU parser badly enough that the project would not open.
    const result = build('system/standard/TON')
    const variant: Record<string, unknown> = result.ok ? { ...result.variant } : {}

    expect(variant.body).toBeUndefined()
    expect(variant.language).toBeUndefined()
    expect(Object.keys(variant).sort()).toEqual(['documentation', 'extensible', 'name', 'type', 'variables'])
  })

  it('defaults extensible to false when the library omits it', () => {
    expect(build('system/standard/CTU')).toMatchObject({ ok: true, variant: { extensible: false } })
  })

  it('reports an unknown block', () => {
    expect(build('system/standard/NOPE')).toEqual({
      ok: false,
      reason: 'unknown-pou',
      libraryType: 'system',
      blockRef: 'system/standard/NOPE',
    })
  })

  it('reports an unknown library', () => {
    expect(build('system/nope/TON')).toEqual({
      ok: false,
      reason: 'unknown-pou',
      libraryType: 'system',
      blockRef: 'system/nope/TON',
    })
  })

  it('reports a reference missing its POU segment', () => {
    expect(build('system/standard')).toEqual({
      ok: false,
      reason: 'malformed-ref',
      libraryType: 'system',
      blockRef: 'system/standard',
    })
  })
})

describe('buildBlockVariant — user POU branch', () => {
  it('rebuilds each pin and upper-cases its type', () => {
    expect(build('user/Latch')).toEqual({
      ok: true,
      variant: {
        name: 'Latch',
        type: 'function-block',
        documentation: 'Set-dominant latch',
        extensible: false,
        variables: [
          { id: 'v1', name: 'S', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
          { id: 'v2', name: 'Q', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        ],
      },
    })
  })

  it('synthesizes the OUT pin for a function from its return type', () => {
    // A function's return is a pin on the diagram but not a declared variable,
    // so nothing else would produce it.
    const result = build('user/Scale')
    const variables = result.ok ? result.variant.variables : []

    expect(variables).toHaveLength(2)
    expect(variables[1]).toEqual({
      id: 'OUT',
      name: 'OUT',
      class: 'output',
      type: { definition: 'base-type', value: 'REAL' },
    })
  })

  it('does not synthesize OUT for a function block', () => {
    const result = build('user/Latch')

    expect(result.ok && result.variant.variables.some((pin) => pin.name === 'OUT')).toBe(false)
  })

  it('reports a library entry with no matching POU', () => {
    expect(build('user/Ghost')).toEqual({
      ok: false,
      reason: 'unknown-pou',
      libraryType: 'user',
      blockRef: 'user/Ghost',
    })
  })

  it('reports a name that is in no user library', () => {
    expect(build('user/Nope')).toEqual({
      ok: false,
      reason: 'unknown-library',
      libraryType: 'user',
      blockRef: 'user/Nope',
    })
  })
})

describe('buildBlockVariant — malformed references', () => {
  it.each([['TON'], ['weird/standard/TON'], ['']])('rejects %p', (blockRef) => {
    expect(build(blockRef)).toEqual({ ok: false, reason: 'malformed-ref', libraryType: 'unknown', blockRef })
  })
})
