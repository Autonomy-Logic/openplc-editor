import type { PLCProjectData } from '../../../../middleware/shared/ports/types'
import { collectNativePous } from '../native-pou-list'

function project(pous: Array<{ name: string; pouType: string; language: string }>): PLCProjectData {
  return {
    pous: pous.map((p) => ({
      name: p.name,
      pouType: p.pouType,
      interface: { variables: [] },
      body: { language: p.language, value: '' },
    })),
  } as unknown as PLCProjectData
}

describe('collectNativePous', () => {
  it('returns nothing for a project with no native POUs', () => {
    expect(collectNativePous(project([{ name: 'main', pouType: 'program', language: 'st' }]))).toEqual([])
  })

  it('returns nothing for an empty project', () => {
    expect(collectNativePous(project([]))).toEqual([])
  })

  it('maps a C++ function block to its authored .cpp path', () => {
    expect(collectNativePous(project([{ name: 'TCP_CLIENT', pouType: 'function-block', language: 'cpp' }]))).toEqual([
      { name: 'TCP_CLIENT', language: 'cpp', relPath: 'pous/function-blocks/TCP_CLIENT.cpp' },
    ])
  })

  it('maps a Python function block to its authored .py path', () => {
    expect(collectNativePous(project([{ name: 'SCALE', pouType: 'function-block', language: 'python' }]))).toEqual([
      { name: 'SCALE', language: 'python', relPath: 'pous/function-blocks/SCALE.py' },
    ])
  })

  // A hand-authored project may declare a native POU as a FUNCTION. The path
  // has to follow the POU type so the build hands strucpp the file and lets it
  // explain that a native block must be a FUNCTION_BLOCK, rather than failing
  // on a path guessed wrong.
  it.each([
    ['function', 'pous/functions/CPP_ADD.cpp'],
    ['program', 'pous/programs/CPP_ADD.cpp'],
    ['function-block', 'pous/function-blocks/CPP_ADD.cpp'],
  ])('resolves a %s POU under its own directory', (pouType, relPath) => {
    expect(collectNativePous(project([{ name: 'CPP_ADD', pouType, language: 'cpp' }]))[0].relPath).toBe(relPath)
  })

  it('falls back to the function-block directory for an unrecognised POU type', () => {
    expect(collectNativePous(project([{ name: 'Odd', pouType: 'weird', language: 'cpp' }]))[0].relPath).toBe(
      'pous/function-blocks/Odd.cpp',
    )
  })

  it('keeps declaration order and skips non-native POUs', () => {
    const refs = collectNativePous(
      project([
        { name: 'main', pouType: 'program', language: 'st' },
        { name: 'B', pouType: 'function-block', language: 'cpp' },
        { name: 'Rungs', pouType: 'program', language: 'ld' },
        { name: 'A', pouType: 'function-block', language: 'python' },
      ]),
    )
    expect(refs.map((r) => `${r.name}:${r.language}`)).toEqual(['B:cpp', 'A:python'])
  })

  // The whole reason this helper exists: `preprocessPous` lowers native bodies
  // to bridge ST and rewrites the language tag with them, so a list derived
  // after that step finds nothing and the archive ships the bridge instead of
  // the authored source.
  it('finds nothing once the bodies have been lowered to ST', () => {
    expect(collectNativePous(project([{ name: 'CPP_SCALE', pouType: 'function-block', language: 'st' }]))).toEqual([])
  })

  it('tolerates a POU with no body', () => {
    const data = { pous: [{ name: 'Broken', pouType: 'function-block' }] } as unknown as PLCProjectData
    expect(collectNativePous(data)).toEqual([])
  })
})
