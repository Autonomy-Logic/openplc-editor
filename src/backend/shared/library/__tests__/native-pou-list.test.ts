import type { PLCBody, PLCPou, PouType } from '../../../../middleware/shared/ports/open-plc-types'
import type { PLCProjectData } from '../../../../middleware/shared/ports/types'
import { collectNativePous, parseNativePouRefs } from '../native-pou-list'

/** A typed project fixture — only `pous` is read, the rest is a valid empty. */
function project(pous: Array<{ name: string; pouType: PouType; language: PLCBody['language'] }>): PLCProjectData {
  const built: PLCPou[] = pous.map((p) => ({
    name: p.name,
    pouType: p.pouType,
    interface: { variables: [] },
    body: { language: p.language, value: '' } as PLCBody,
    documentation: '',
  }))
  return {
    pous: built,
    dataTypes: [],
    configurations: { resource: { tasks: [], instances: [], globalVariables: [] } },
  }
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
    // `pouType` is a union, so an unknown value can only arrive from data the
    // types do not describe — a hand-edited project.json. The fallback keeps
    // the build pointed somewhere sensible instead of at `undefined/Odd.cpp`.
    const odd: PLCProjectData = {
      pous: [
        {
          name: 'Odd',
          pouType: 'weird' as PouType,
          interface: { variables: [] },
          body: { language: 'cpp', value: '' } as PLCBody,
          documentation: '',
        },
      ],
      dataTypes: [],
      configurations: { resource: { tasks: [], instances: [], globalVariables: [] } },
    }
    expect(collectNativePous(odd)[0].relPath).toBe('pous/function-blocks/Odd.cpp')
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
    // Same provenance as above: only malformed on-disk data produces this.
    const noBody: PLCProjectData = {
      pous: [{ name: 'Broken', pouType: 'function-block', interface: { variables: [] }, documentation: '' } as PLCPou],
      dataTypes: [],
      configurations: { resource: { tasks: [], instances: [], globalVariables: [] } },
    }
    expect(collectNativePous(noBody)).toEqual([])
  })
})

describe('parseNativePouRefs', () => {
  const valid = { name: 'CPP_SCALE', language: 'cpp', relPath: 'pous/function-blocks/CPP_SCALE.cpp' }

  it('accepts a well-formed list', () => {
    expect(parseNativePouRefs([valid])).toEqual([valid])
  })

  // Arrives over IPC, so it is `unknown` whatever the renderer meant to send.
  // Unreadable input degrades to "no native POUs" rather than throwing inside
  // the pipeline, out of a handler invoked with `void`.
  it.each([
    ['undefined (older renderer)', undefined],
    ['null', null],
    ['a string', 'nope'],
    ['an object', { name: 'x' }],
  ])('returns an empty list for %s', (_label, value) => {
    expect(parseNativePouRefs(value)).toEqual([])
  })

  it.each([
    ['a null entry', null],
    ['a non-object entry', 'CPP_SCALE'],
    ['a missing name', { language: 'cpp', relPath: 'a/b.cpp' }],
    ['an empty name', { name: '', language: 'cpp', relPath: 'a/b.cpp' }],
    ['a missing relPath', { name: 'X', language: 'cpp' }],
    ['an empty relPath', { name: 'X', language: 'cpp', relPath: '' }],
    ['a non-string relPath', { name: 'X', language: 'cpp', relPath: 42 }],
    ['an unknown language', { name: 'X', language: 'rust', relPath: 'a/b.rs' }],
  ])('drops %s', (_label, entry) => {
    expect(parseNativePouRefs([entry])).toEqual([])
  })

  it('keeps the good entries and drops only the bad ones', () => {
    expect(parseNativePouRefs([valid, { name: 'Bad' }, null, { ...valid, name: 'PY', language: 'python' }])).toEqual([
      valid,
      { name: 'PY', language: 'python', relPath: valid.relPath },
    ])
  })
})
