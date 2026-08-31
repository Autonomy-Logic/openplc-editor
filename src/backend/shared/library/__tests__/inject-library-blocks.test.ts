import type { StlibArchiveDTO } from '../../../../middleware/shared/ports/library-port'
import type { PLCProjectData } from '../../../../middleware/shared/ports/types'
import {
  findLibrariesMissingNativeSources,
  injectLibraryBlocks,
  libraryBlockPouName,
  projectAndLibraryTypeNames,
} from '../inject-library-blocks'

// -- helpers ------------------------------------------------------------------

/** A whole authored native POU file: ST header + native body. */
const cppFile = (name: string, body = 'void setup() {}\nvoid loop() { SCALED = RAW * GAIN; }') => `(* Scales *)
FUNCTION_BLOCK ${name}
VAR_INPUT
  RAW : INT;
  GAIN : INT;
END_VAR
VAR_OUTPUT
  SCALED : INT;
END_VAR
${body}
END_FUNCTION_BLOCK
`

const pyFile = (name: string) => `FUNCTION_BLOCK ${name}
VAR_INPUT
  IN_VAL : INT;
END_VAR
VAR_OUTPUT
  OUT_VAL : INT;
END_VAR
def block_loop():
    global OUT_VAL
    OUT_VAL = IN_VAL + 1
END_FUNCTION_BLOCK
`

function project(overrides: { libraries?: Array<{ name: string; version: string }>; pous?: string[] }): PLCProjectData {
  return {
    pous: (overrides.pous ?? []).map((name) => ({
      name,
      pouType: 'program',
      interface: { variables: [] },
      body: { language: 'st', value: 'x := 1;' },
    })),
    ...(overrides.libraries ? { libraries: overrides.libraries } : {}),
  } as unknown as PLCProjectData
}

/** An archive shaped the way strucpp now emits one. */
function archive(
  name: string,
  blocks: Array<{ name: string; language: 'cpp' | 'python'; file?: string; source?: string | null }> = [],
  opts: { stBlocks?: string[]; namespace?: string; types?: Array<{ name: string; kind: string }> } = {},
): StlibArchiveDTO {
  const sources: Array<{ fileName: string; source: string }> = []
  const functionBlocks: unknown[] = (opts.stBlocks ?? []).map((n) => ({
    name: n,
    inputs: [],
    outputs: [],
    inouts: [],
  }))

  for (const block of blocks) {
    const fileName = block.file ?? `${block.name}.${block.language === 'cpp' ? 'cpp' : 'py'}`
    const source =
      block.source === undefined ? (block.language === 'cpp' ? cppFile(block.name) : pyFile(block.name)) : block.source
    functionBlocks.push({
      name: block.name,
      inputs: [],
      outputs: [],
      inouts: [],
      implementation: block.language,
      sourceFile: fileName,
    })
    if (source !== null) sources.push({ fileName, source })
  }

  return {
    manifest: {
      name,
      version: '1.0.0',
      functionBlocks,
      ...(opts.namespace ? { namespace: opts.namespace } : {}),
      ...(opts.types ? { types: opts.types } : {}),
    },
    sources,
  } as unknown as StlibArchiveDTO
}

// -- tests --------------------------------------------------------------------

describe('libraryBlockPouName', () => {
  it('prefixes the block with its library, double-underscore separated', () => {
    expect(libraryBlockPouName('network_tools', 'TCP_CLIENT')).toBe('network_tools__TCP_CLIENT')
  })
})

describe('the identifier a grafted block is prefixed with', () => {
  // The prefix becomes an ST POU name. `manifest.name` is only checked for path
  // safety, so `modbee-protocol` is a legal name — and produced
  // `modbee-protocol__TOPIC`, which no parser accepts. The failure appeared
  // only in the CONSUMING project, naming a POU nobody wrote.
  const data = project({ pous: ['main'], libraries: [{ name: 'modbee-protocol', version: '1.0.0' }] })

  it('takes the namespace, so a hyphenated library name still parses', () => {
    const grafted = injectLibraryBlocks(data, [
      archive('modbee-protocol', [{ name: 'TOPIC', language: 'cpp' }], { namespace: 'modbee_protocol' }),
    ])
    expect(grafted.pous.map((pou) => pou.name)).toContain('modbee_protocol__TOPIC')
  })

  it('falls back to folding the name when an older archive declares no namespace', () => {
    const grafted = injectLibraryBlocks(data, [archive('modbee-protocol', [{ name: 'TOPIC', language: 'cpp' }])])
    expect(grafted.pous.map((pou) => pou.name)).toContain('modbee_protocol__TOPIC')
  })

  it('does not let a folded name start with a digit', () => {
    const numeric = project({ pous: ['main'], libraries: [{ name: '3d-tools', version: '1.0.0' }] })
    const grafted = injectLibraryBlocks(numeric, [archive('3d-tools', [{ name: 'MOVE', language: 'cpp' }])])
    expect(grafted.pous.map((pou) => pou.name)).toContain('_3d_tools__MOVE')
  })

  it('ignores a namespace that is not an identifier and folds instead', () => {
    const grafted = injectLibraryBlocks(data, [
      archive('modbee-protocol', [{ name: 'TOPIC', language: 'cpp' }], { namespace: 'not an identifier' }),
    ])
    expect(grafted.pous.map((pou) => pou.name)).toContain('modbee_protocol__TOPIC')
  })
})

describe('projectAndLibraryTypeNames', () => {
  // The native bridge spells a pin `strucpp::IEC_<NAME>` for a declared data
  // type and `strucpp::<NAME>` otherwise. Built from the project alone, a pin
  // typed by a LIBRARY's enum was spelled bare while strucpp had declared
  // `IEC_<NAME>`, and the POU glue failed on the pointer assignment.
  const enumType = { name: 'MB_SPACE', kind: 'enum' }

  it('includes the types an enabled library declares', () => {
    const data = project({ pous: ['main'], libraries: [{ name: 'modbee-protocol', version: '1.0.0' }] })
    const names = projectAndLibraryTypeNames(data, [archive('modbee-protocol', [], { types: [enumType] })])
    expect(names).toContain('MB_SPACE')
  })

  it('leaves out a library the project has not enabled', () => {
    const data = project({ pous: ['main'] })
    const names = projectAndLibraryTypeNames(data, [archive('modbee-protocol', [], { types: [enumType] })])
    expect(names).not.toContain('MB_SPACE')
  })

  it('keeps the project own types alongside them', () => {
    const data = {
      ...project({ pous: ['main'], libraries: [{ name: 'modbee-protocol', version: '1.0.0' }] }),
      dataTypes: [{ name: 'MOTOR' }],
    } as unknown as PLCProjectData
    const names = projectAndLibraryTypeNames(data, [archive('modbee-protocol', [], { types: [enumType] })])
    expect(names).toEqual(expect.arrayContaining(['MOTOR', 'MB_SPACE']))
  })

  it('includes every kind of data type, not just enumerations', () => {
    // The bridge's IEC_ prefix rule applies to all three: strucpp aliases a
    // structure and an array to themselves and an enumeration to IEC_ENUM<>,
    // so a pin of any of them is spelled IEC_<NAME>.
    const data = project({ pous: ['main'], libraries: [{ name: 'modbee-protocol', version: '1.0.0' }] })
    const names = projectAndLibraryTypeNames(data, [
      archive('modbee-protocol', [], {
        types: [
          { name: 'MB_SPACE', kind: 'enum' },
          { name: 'MB_CFG', kind: 'struct' },
          { name: 'MB_TREND', kind: 'alias' },
        ],
      }),
    ])
    expect(names).toEqual(expect.arrayContaining(['MB_SPACE', 'MB_CFG', 'MB_TREND']))
  })

  it('copes with an archive that declares no types at all', () => {
    const data = project({ pous: ['main'], libraries: [{ name: 'modbee-protocol', version: '1.0.0' }] })
    expect(projectAndLibraryTypeNames(data, [archive('modbee-protocol')])).toEqual([])
  })
})

describe('injectLibraryBlocks', () => {
  it('returns the same object when the project enables no libraries', () => {
    const data = project({ pous: ['main'] })
    expect(injectLibraryBlocks(data, [archive('lib', [{ name: 'X', language: 'cpp' }])])).toBe(data)
  })

  it('returns the same object when the library list is empty', () => {
    const data = project({ pous: ['main'], libraries: [] })
    expect(injectLibraryBlocks(data, [archive('lib', [{ name: 'X', language: 'cpp' }])])).toBe(data)
  })

  it('returns the same object for a library of only ST blocks', () => {
    const data = project({ libraries: [{ name: 'lib', version: '1.0.0' }] })
    expect(injectLibraryBlocks(data, [archive('lib', [], { stBlocks: ['ST_ADD'] })])).toBe(data)
  })

  it('grafts a C++ block, parsing its interface and body from the authored file', () => {
    const data = project({ pous: ['main'], libraries: [{ name: 'network_tools', version: '1.0.0' }] })
    const result = injectLibraryBlocks(data, [archive('network_tools', [{ name: 'TCP_CLIENT', language: 'cpp' }])])

    expect(result).not.toBe(data)
    expect(result.pous.map((p) => p.name)).toEqual(['main', 'network_tools__TCP_CLIENT'])

    const grafted = result.pous[1]
    expect(grafted.pouType).toBe('function-block')
    expect(grafted.body.language).toBe('cpp')
    // Interface recovered from the ST header, not from serialized metadata.
    expect(grafted.interface?.variables.map((v) => `${v.name}:${v.class}`)).toEqual([
      'RAW:input',
      'GAIN:input',
      'SCALED:output',
    ])
    // Body is the native code only — the ST header is stripped, exactly as it
    // is for a POU read off disk.
    expect(grafted.body.value).toContain('void loop()')
    expect(grafted.body.value).not.toContain('VAR_INPUT')
    expect(grafted.documentation).toBe('Scales')
  })

  it('grafts a Python block as a python POU', () => {
    const data = project({ libraries: [{ name: 'pylib', version: '1.0.0' }] })
    const result = injectLibraryBlocks(data, [archive('pylib', [{ name: 'SCALE', language: 'python' }])])

    expect(result.pous).toHaveLength(1)
    expect(result.pous[0].name).toBe('pylib__SCALE')
    expect(result.pous[0].body.language).toBe('python')
    expect(result.pous[0].body.value).toContain('def block_loop()')
  })

  it('grafts C++ and Python blocks from one archive, leaving ST blocks alone', () => {
    const data = project({ libraries: [{ name: 'mixed', version: '1.0.0' }] })
    const result = injectLibraryBlocks(data, [
      archive(
        'mixed',
        [
          { name: 'C', language: 'cpp' },
          { name: 'P', language: 'python' },
        ],
        { stBlocks: ['S'] },
      ),
    ])

    expect(result.pous.map((p) => `${p.name}:${p.body.language}`)).toEqual(['mixed__C:cpp', 'mixed__P:python'])
  })

  it('ignores archives the project has not enabled', () => {
    const data = project({ libraries: [{ name: 'enabled', version: '1.0.0' }] })
    const result = injectLibraryBlocks(data, [
      archive('enabled', [{ name: 'Yes', language: 'cpp' }]),
      archive('disabled', [{ name: 'No', language: 'cpp' }]),
    ])

    expect(result.pous.map((p) => p.name)).toEqual(['enabled__Yes'])
  })

  it('ignores an archive with no manifest name', () => {
    const data = project({ libraries: [{ name: 'lib', version: '1.0.0' }] })
    const broken = { sources: [] } as unknown as StlibArchiveDTO
    expect(injectLibraryBlocks(data, [broken])).toBe(data)
  })

  it('resolves the source by sourceFile, not by guessing from the block name', () => {
    const data = project({ libraries: [{ name: 'lib', version: '1.0.0' }] })
    const result = injectLibraryBlocks(data, [
      archive('lib', [{ name: 'Block', language: 'cpp', file: 'differently_named.cpp' }]),
    ])
    expect(result.pous.map((p) => p.name)).toEqual(['lib__Block'])
  })

  it('skips a native block whose manifest entry names no source file', () => {
    const data = project({ libraries: [{ name: 'lib', version: '1.0.0' }] })
    const noSourceFile = {
      manifest: {
        name: 'lib',
        version: '1.0.0',
        functionBlocks: [{ name: 'X', inputs: [], outputs: [], inouts: [], implementation: 'cpp' }],
      },
    } as unknown as StlibArchiveDTO
    expect(injectLibraryBlocks(data, [noSourceFile]).pous).toEqual([])
  })

  it('tolerates an archive with no manifest.functionBlocks array', () => {
    const data = project({ pous: ['main'], libraries: [{ name: 'lib', version: '1.0.0' }] })
    const bare = { manifest: { name: 'lib', version: '1.0.0' } } as unknown as StlibArchiveDTO
    expect(injectLibraryBlocks(data, [bare])).toBe(data)
  })

  it('skips a block whose source is missing from the archive', () => {
    const data = project({ libraries: [{ name: 'lib', version: '1.0.0' }] })
    const result = injectLibraryBlocks(data, [archive('lib', [{ name: 'Gone', language: 'cpp', source: null }])])
    expect(result.pous).toEqual([])
  })

  it('skips a block whose header the parser rejects, without aborting the graft', () => {
    const data = project({ libraries: [{ name: 'lib', version: '1.0.0' }] })
    const result = injectLibraryBlocks(data, [
      archive('lib', [
        { name: 'Bad', language: 'cpp', source: 'this is not a POU at all' },
        { name: 'Good', language: 'cpp' },
      ]),
    ])
    expect(result.pous.map((p) => p.name)).toEqual(['lib__Good'])
  })

  it('returns the project untouched when every native block fails to parse', () => {
    const data = project({ pous: ['main'], libraries: [{ name: 'lib', version: '1.0.0' }] })
    const result = injectLibraryBlocks(data, [archive('lib', [{ name: 'Bad', language: 'cpp', source: 'not a POU' }])])
    expect(result).toBe(data)
  })

  it('does not mutate the input project', () => {
    const data = project({ pous: ['main'], libraries: [{ name: 'lib', version: '1.0.0' }] })
    injectLibraryBlocks(data, [archive('lib', [{ name: 'X', language: 'cpp' }])])
    expect(data.pous).toHaveLength(1)
  })
})

describe('findLibrariesMissingNativeSources', () => {
  it('returns nothing when the project enables no libraries', () => {
    expect(
      findLibrariesMissingNativeSources(project({}), [archive('lib', [{ name: 'X', language: 'cpp', source: null }])]),
    ).toEqual([])
  })

  it('returns nothing when every native block carries source', () => {
    const data = project({ libraries: [{ name: 'lib', version: '1.0.0' }] })
    const archives = [
      archive('lib', [
        { name: 'X', language: 'cpp' },
        { name: 'Y', language: 'python' },
      ]),
    ]
    expect(findLibrariesMissingNativeSources(data, archives)).toEqual([])
  })

  it('returns nothing for a library of only ST blocks', () => {
    const data = project({ libraries: [{ name: 'lib', version: '1.0.0' }] })
    expect(findLibrariesMissingNativeSources(data, [archive('lib', [], { stBlocks: ['S'] })])).toEqual([])
  })

  it.each([
    ['absent from sources', null],
    ['present but empty', ''],
    ['whitespace only', '   \n '],
  ])('flags a library whose native source is %s', (_label, source) => {
    const data = project({ libraries: [{ name: 'lib', version: '1.0.0' }] })
    expect(findLibrariesMissingNativeSources(data, [archive('lib', [{ name: 'X', language: 'cpp', source }])])).toEqual(
      ['lib'],
    )
  })

  it('reports each library once even with several sourceless blocks', () => {
    const data = project({ libraries: [{ name: 'lib', version: '1.0.0' }] })
    const archives = [
      archive('lib', [
        { name: 'A', language: 'cpp', source: null },
        { name: 'B', language: 'python', source: null },
      ]),
    ]
    expect(findLibrariesMissingNativeSources(data, archives)).toEqual(['lib'])
  })

  it('ignores sourceless blocks in libraries the project has not enabled', () => {
    const data = project({ libraries: [{ name: 'enabled', version: '1.0.0' }] })
    const archives = [
      archive('enabled', [{ name: 'Good', language: 'cpp' }]),
      archive('disabled', [{ name: 'Bad', language: 'cpp', source: null }]),
    ]
    expect(findLibrariesMissingNativeSources(data, archives)).toEqual([])
  })
})
