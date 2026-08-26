import type { StlibArchiveDTO } from '../../../../middleware/shared/ports/library-port'
import type { PLCProjectData } from '../../../../middleware/shared/ports/types'
import { findLibrariesMissingNativeSources, injectLibraryBlocks, libraryBlockPouName } from '../inject-library-blocks'

// -- helpers ------------------------------------------------------------------

function project(overrides: {
  libraries?: Array<{ name: string; version: string }>
  pous?: Array<{ name: string }>
}): PLCProjectData {
  return {
    pous: (overrides.pous ?? []).map((p) => ({
      name: p.name,
      pouType: 'program',
      interface: { variables: [] },
      body: { language: 'st', value: 'x := 1;' },
    })),
    ...(overrides.libraries ? { libraries: overrides.libraries } : {}),
  } as unknown as PLCProjectData
}

function archive(name: string, blocks: { cppBlocks?: unknown[]; pythonBlocks?: unknown[] } = {}): StlibArchiveDTO {
  return {
    manifest: { name, version: '1.0.0' },
    ...blocks,
  } as unknown as StlibArchiveDTO
}

const cppBlock = (name: string, code = 'void setup(){}\nvoid loop(){}') => ({
  name,
  code,
  variables: [{ name: 'EN', class: 'input', type: { definition: 'base-type', value: 'BOOL' } }],
})

const pyBlock = (name: string, code = 'out = inp + 1') => ({
  name,
  code,
  variables: [{ name: 'inp', class: 'input', type: { definition: 'base-type', value: 'INT' } }],
})

// -- tests --------------------------------------------------------------------

describe('libraryBlockPouName', () => {
  it('prefixes the block with its library, double-underscore separated', () => {
    expect(libraryBlockPouName('network_tools', 'TCP_CLIENT')).toBe('network_tools__TCP_CLIENT')
  })
})

describe('injectLibraryBlocks', () => {
  it('returns the same object when the project enables no libraries', () => {
    const data = project({ pous: [{ name: 'Main' }] })
    expect(injectLibraryBlocks(data, [archive('lib', { cppBlocks: [cppBlock('X')] })])).toBe(data)
  })

  it('returns the same object when the project has an empty library list', () => {
    const data = project({ pous: [{ name: 'Main' }], libraries: [] })
    expect(injectLibraryBlocks(data, [archive('lib', { cppBlocks: [cppBlock('X')] })])).toBe(data)
  })

  it('returns the same object when no enabled library ships native blocks', () => {
    const data = project({ pous: [{ name: 'Main' }], libraries: [{ name: 'lib', version: '1.0.0' }] })
    expect(injectLibraryBlocks(data, [archive('lib')])).toBe(data)
  })

  it('grafts C++ blocks as cpp POUs under the prefixed name', () => {
    const data = project({ pous: [{ name: 'Main' }], libraries: [{ name: 'network_tools', version: '1.0.0' }] })
    const result = injectLibraryBlocks(data, [
      archive('network_tools', { cppBlocks: [cppBlock('TCP_CLIENT'), cppBlock('UDP_SEND')] }),
    ])

    expect(result).not.toBe(data)
    expect(result.pous.map((p) => p.name)).toEqual(['Main', 'network_tools__TCP_CLIENT', 'network_tools__UDP_SEND'])

    const grafted = result.pous[1]
    expect(grafted.pouType).toBe('function-block')
    expect(grafted.body.language).toBe('cpp')
    expect(grafted.body.value).toBe('void setup(){}\nvoid loop(){}')
    expect(grafted.interface?.variables).toEqual(cppBlock('TCP_CLIENT').variables)
  })

  it('grafts Python blocks as python POUs', () => {
    const data = project({ libraries: [{ name: 'pylib', version: '1.0.0' }] })
    const result = injectLibraryBlocks(data, [archive('pylib', { pythonBlocks: [pyBlock('SCALE')] })])

    expect(result.pous).toHaveLength(1)
    expect(result.pous[0].name).toBe('pylib__SCALE')
    expect(result.pous[0].body.language).toBe('python')
    expect(result.pous[0].body.value).toBe('out = inp + 1')
  })

  it('grafts C++ and Python blocks from the same archive', () => {
    const data = project({ libraries: [{ name: 'mixed', version: '1.0.0' }] })
    const result = injectLibraryBlocks(data, [
      archive('mixed', { cppBlocks: [cppBlock('C')], pythonBlocks: [pyBlock('P')] }),
    ])

    expect(result.pous.map((p) => `${p.name}:${p.body.language}`)).toEqual(['mixed__C:cpp', 'mixed__P:python'])
  })

  it('ignores archives the project has not enabled', () => {
    const data = project({ libraries: [{ name: 'enabled', version: '1.0.0' }] })
    const result = injectLibraryBlocks(data, [
      archive('enabled', { cppBlocks: [cppBlock('Yes')] }),
      archive('disabled', { cppBlocks: [cppBlock('No')] }),
    ])

    expect(result.pous.map((p) => p.name)).toEqual(['enabled__Yes'])
  })

  it('ignores an archive with no manifest name', () => {
    const data = project({ libraries: [{ name: 'lib', version: '1.0.0' }] })
    const broken = { cppBlocks: [cppBlock('X')] } as unknown as StlibArchiveDTO
    expect(injectLibraryBlocks(data, [broken])).toBe(data)
  })

  it('carries documentation through, defaulting to empty', () => {
    const data = project({ libraries: [{ name: 'lib', version: '1.0.0' }] })
    const result = injectLibraryBlocks(data, [
      archive('lib', {
        cppBlocks: [{ ...cppBlock('Documented'), documentation: 'Does a thing.' }, cppBlock('Bare')],
      }),
    ])

    expect(result.pous[0].documentation).toBe('Does a thing.')
    expect(result.pous[1].documentation).toBe('')
  })

  it('does not mutate the input project', () => {
    const data = project({ pous: [{ name: 'Main' }], libraries: [{ name: 'lib', version: '1.0.0' }] })
    const before = data.pous.length
    injectLibraryBlocks(data, [archive('lib', { cppBlocks: [cppBlock('X')] })])
    expect(data.pous).toHaveLength(before)
  })
})

describe('findLibrariesMissingNativeSources', () => {
  it('returns nothing when the project enables no libraries', () => {
    expect(
      findLibrariesMissingNativeSources(project({}), [archive('lib', { cppBlocks: [cppBlock('X', '')] })]),
    ).toEqual([])
  })

  it('returns nothing when the library list is empty', () => {
    const data = project({ libraries: [] })
    expect(findLibrariesMissingNativeSources(data, [archive('lib', { cppBlocks: [cppBlock('X', '')] })])).toEqual([])
  })

  it('returns nothing for libraries with no native blocks', () => {
    const data = project({ libraries: [{ name: 'lib', version: '1.0.0' }] })
    expect(findLibrariesMissingNativeSources(data, [archive('lib')])).toEqual([])
  })

  it('returns nothing when every native block carries source', () => {
    const data = project({ libraries: [{ name: 'lib', version: '1.0.0' }] })
    const archives = [archive('lib', { cppBlocks: [cppBlock('X')], pythonBlocks: [pyBlock('Y')] })]
    expect(findLibrariesMissingNativeSources(data, archives)).toEqual([])
  })

  it.each([
    ['an empty string', ''],
    ['whitespace only', '   \n  '],
  ])('flags a library whose C++ block source is %s', (_label, code) => {
    const data = project({ libraries: [{ name: 'lib', version: '1.0.0' }] })
    expect(findLibrariesMissingNativeSources(data, [archive('lib', { cppBlocks: [cppBlock('X', code)] })])).toEqual([
      'lib',
    ])
  })

  it('flags a library whose Python block has no source', () => {
    const data = project({ libraries: [{ name: 'pylib', version: '1.0.0' }] })
    expect(findLibrariesMissingNativeSources(data, [archive('pylib', { pythonBlocks: [pyBlock('Y', '')] })])).toEqual([
      'pylib',
    ])
  })

  it('flags a library whose block source is not a string at all', () => {
    const data = project({ libraries: [{ name: 'lib', version: '1.0.0' }] })
    const bad = archive('lib', { cppBlocks: [{ name: 'X', variables: [] }] })
    expect(findLibrariesMissingNativeSources(data, [bad])).toEqual(['lib'])
  })

  it('ignores sourceless blocks in libraries the project has not enabled', () => {
    const data = project({ libraries: [{ name: 'enabled', version: '1.0.0' }] })
    const archives = [
      archive('enabled', { cppBlocks: [cppBlock('Good')] }),
      archive('disabled', { cppBlocks: [cppBlock('Bad', '')] }),
    ]
    expect(findLibrariesMissingNativeSources(data, archives)).toEqual([])
  })

  it('ignores an archive with no manifest name', () => {
    const data = project({ libraries: [{ name: 'lib', version: '1.0.0' }] })
    const broken = { cppBlocks: [cppBlock('X', '')] } as unknown as StlibArchiveDTO
    expect(findLibrariesMissingNativeSources(data, [broken])).toEqual([])
  })
})
