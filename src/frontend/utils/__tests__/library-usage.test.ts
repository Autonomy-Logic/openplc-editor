import type { PLCPou } from '../../../middleware/shared/ports/types'
import {
  derivedTypesInUse,
  findOwningLibrary,
  type InstalledLibraryShape,
  librariesOwningTypes,
  librariesUsedByProject,
} from '../library-usage'

const lib = (name: string, pous: string[], version = '1.0.0'): InstalledLibraryShape => ({
  name,
  version,
  pous: pous.map((p) => ({ name: p })),
})

const SYSTEM = [
  lib('iec-standard-fb', ['TON', 'CTD_DINT']),
  lib('demo-utils', ['ANALOGSCALE', 'MOVINGAVERAGE'], '2.1.0'),
]
const BUNDLED = ['iec-standard-fb']

const pouWith = (variables: Array<{ definition: string; value: string }>): PLCPou =>
  ({
    name: 'main',
    pouType: 'program',
    interface: { variables: variables.map((v, i) => ({ name: `v${i}`, type: v })) },
  }) as unknown as PLCPou

describe('findOwningLibrary', () => {
  it('matches the block name case-insensitively, the way the editors resolve blocks', () => {
    expect(findOwningLibrary(SYSTEM, 'analogscale')?.name).toBe('demo-utils')
  })

  it('answers nothing for a type no installed library provides', () => {
    expect(findOwningLibrary(SYSTEM, 'MY_STRUCT')).toBeUndefined()
  })
})

describe('librariesOwningTypes', () => {
  it('names the non-bundled owners once each, in first-seen order', () => {
    expect(librariesOwningTypes(SYSTEM, BUNDLED, ['ANALOGSCALE', 'MOVINGAVERAGE', 'ANALOGSCALE'])).toEqual([
      'demo-utils',
    ])
  })

  it('leaves bundled libraries out: they are always on and never declared', () => {
    expect(librariesOwningTypes(SYSTEM, BUNDLED, ['TON', 'ANALOGSCALE'])).toEqual(['demo-utils'])
  })

  it('does not guess at a type nobody installed owns', () => {
    expect(librariesOwningTypes(SYSTEM, BUNDLED, ['UNKNOWN_FB'])).toEqual([])
  })
})

describe('derivedTypesInUse', () => {
  it('collects derived variable types across POUs and skips base types', () => {
    const pous = [
      pouWith([
        { definition: 'derived', value: 'ANALOGSCALE' },
        { definition: 'base-type', value: 'REAL' },
      ]),
      pouWith([{ definition: 'derived', value: 'TON' }]),
      // The ST parser spells an instance of a non-base type this way.
      pouWith([{ definition: 'user-data-type', value: 'FT_AVG' }]),
    ]

    expect(derivedTypesInUse(pous)).toEqual(['ANALOGSCALE', 'TON', 'FT_AVG'])
  })
})

describe('librariesUsedByProject', () => {
  /**
   * The gap this closes: a ladder block from a library creates an FB instance
   * variable but never a `project.libraries` entry, so the other editor got a
   * project that used the library with nothing telling it so.
   */
  it('reads usage from the instances, so a placed block counts as using its library', () => {
    const pous = [pouWith([{ definition: 'derived', value: 'ANALOGSCALE' }])]

    expect(librariesUsedByProject(pous, SYSTEM, BUNDLED)).toEqual(['demo-utils'])
  })

  it('is empty when only bundled blocks are used', () => {
    const pous = [pouWith([{ definition: 'derived', value: 'CTD_DINT' }])]

    expect(librariesUsedByProject(pous, SYSTEM, BUNDLED)).toEqual([])
  })
})
