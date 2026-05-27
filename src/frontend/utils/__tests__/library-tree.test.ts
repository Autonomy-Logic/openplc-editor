/**
 * Tests for `buildLibraryTree`: per-library tree construction from the
 * .stlib `category` paths. Pins the contract every consumer relies on
 * (explorer panel, FBD modal, Ladder modal): folders before POUs in
 * each level, alphabetical within each kind, deep paths share their
 * intermediate folders, and `displayName` becomes the root label.
 */

import { describe, expect, it } from '@jest/globals'

import type { SystemLibrary, SystemLibraryPou } from '../../../middleware/shared/ports/library-types'
import { buildLibraryTree, libraryHasMatch } from '../library-tree'

function makePou(overrides: Partial<SystemLibraryPou> & { name: string }): SystemLibraryPou {
  return {
    type: 'function-block',
    language: 'st',
    variables: [],
    body: '',
    documentation: '',
    ...overrides,
  }
}

function makeLibrary(overrides: Partial<SystemLibrary> & { name: string; pous: SystemLibraryPou[] }): SystemLibrary {
  return {
    author: '',
    version: '1.0.0',
    stPath: '',
    cPath: '',
    ...overrides,
  }
}

describe('buildLibraryTree', () => {
  it('uses displayName as the root label when set', () => {
    const lib = makeLibrary({
      name: 'iec-standard-fb',
      displayName: 'Standard Function Blocks',
      pous: [makePou({ name: 'TON' })],
    })
    const tree = buildLibraryTree(lib)
    expect(tree.label).toBe('Standard Function Blocks')
  })

  it('falls back to the kebab-case name when displayName is absent', () => {
    const lib = makeLibrary({
      name: 'flat-lib',
      pous: [makePou({ name: 'POU_A' })],
    })
    const tree = buildLibraryTree(lib)
    expect(tree.label).toBe('flat-lib')
  })

  it('places category-less POUs directly under the library root', () => {
    const lib = makeLibrary({
      name: 'L',
      pous: [makePou({ name: 'A' }), makePou({ name: 'B' })],
    })
    const tree = buildLibraryTree(lib)
    expect(tree.children).toHaveLength(2)
    expect(tree.children.every((c) => c.kind === 'pou')).toBe(true)
  })

  it('expands a slash-separated category into nested folders', () => {
    // OSCAT-style deep category: POUs/Mathematical/Complex
    const lib = makeLibrary({
      name: 'oscat-basic',
      displayName: 'OSCAT',
      pous: [makePou({ name: 'CADD', category: 'POUs/Mathematical/Complex' })],
    })
    const tree = buildLibraryTree(lib)
    expect(tree.children).toHaveLength(1)
    const pous = tree.children[0]
    expect(pous.kind).toBe('folder')
    if (pous.kind !== 'folder') return
    expect(pous.label).toBe('POUs')
    const math = pous.children[0]
    expect(math.kind).toBe('folder')
    if (math.kind !== 'folder') return
    expect(math.label).toBe('Mathematical')
    const complex = math.children[0]
    expect(complex.kind).toBe('folder')
    if (complex.kind !== 'folder') return
    expect(complex.label).toBe('Complex')
    expect(complex.children).toEqual([
      { kind: 'pou', pou: expect.objectContaining({ name: 'CADD' }), libraryName: 'oscat-basic' },
    ])
  })

  it('shares intermediate folders across siblings with the same prefix', () => {
    // POUs/Mathematical/Array and POUs/Mathematical/Complex must reuse
    // the single "POUs/Mathematical" intermediate folder, not create
    // two copies.
    const lib = makeLibrary({
      name: 'L',
      pous: [
        makePou({ name: 'CADD', category: 'POUs/Mathematical/Complex' }),
        makePou({ name: 'AINIT', category: 'POUs/Mathematical/Array' }),
      ],
    })
    const tree = buildLibraryTree(lib)
    const pous = tree.children[0]
    expect(pous.kind).toBe('folder')
    if (pous.kind !== 'folder') return
    const math = pous.children[0]
    expect(math.kind).toBe('folder')
    if (math.kind !== 'folder') return
    // Two children: Array and Complex (both folders), no duplicate "Mathematical"
    expect(math.children.map((c) => (c.kind === 'folder' ? c.label : c.pou.name))).toEqual(['Array', 'Complex'])
  })

  it('sorts folders before POUs and alphabetizes within each kind', () => {
    const lib = makeLibrary({
      name: 'L',
      pous: [
        makePou({ name: 'ZED' }),
        makePou({ name: 'BORG', category: 'Cat' }),
        makePou({ name: 'ALPHA' }),
        makePou({ name: 'AARDVARK', category: 'Cat' }),
      ],
    })
    const tree = buildLibraryTree(lib)
    expect(tree.children.map((c) => (c.kind === 'folder' ? `[${c.label}]` : c.pou.name))).toEqual([
      '[Cat]', // folder first
      'ALPHA',
      'ZED',
    ])
    const cat = tree.children[0]
    expect(cat.kind).toBe('folder')
    if (cat.kind !== 'folder') return
    expect(cat.children.map((c) => (c.kind === 'pou' ? c.pou.name : '[folder]'))).toEqual(['AARDVARK', 'BORG'])
  })

  it('prunes empty folders when the filter rejects every POU under them', () => {
    const lib = makeLibrary({
      name: 'L',
      pous: [makePou({ name: 'ADD', category: 'Arithmetic' }), makePou({ name: 'SHL', category: 'BitShift' })],
    })
    const tree = buildLibraryTree(lib, (pou) => pou.name.startsWith('A'))
    // BitShift has no surviving children, so it must not appear.
    expect(tree.children.map((c) => (c.kind === 'folder' ? c.label : c.pou.name))).toEqual(['Arithmetic'])
  })
})

describe('libraryHasMatch', () => {
  it('returns true when at least one POU matches the predicate', () => {
    const lib = makeLibrary({
      name: 'L',
      pous: [makePou({ name: 'ADD' }), makePou({ name: 'SHL' })],
    })

    expect(libraryHasMatch(lib, (pou) => pou.name === 'SHL')).toBe(true)
  })

  it('returns false when no POU matches the predicate', () => {
    const lib = makeLibrary({
      name: 'L',
      pous: [makePou({ name: 'ADD' }), makePou({ name: 'SHL' })],
    })

    expect(libraryHasMatch(lib, (pou) => pou.name === 'MISSING')).toBe(false)
  })

  it('returns false for an empty POU list', () => {
    const lib = makeLibrary({ name: 'L', pous: [] })

    expect(libraryHasMatch(lib, () => true)).toBe(false)
  })
})
