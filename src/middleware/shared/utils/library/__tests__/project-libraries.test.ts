import { HMI_PROVIDED_HEADERS } from '../../hmi/widget-libraries'
import { libraryPouRequirements, plcUnusablePous, unusablePouNames, unusablePous } from '../pou-requirements'
import { projectLibraryNames, selectProjectLibraryArchives } from '../project-libraries'

interface ChunkSpec {
  name: string
  deps?: Array<{ library: string; name: string }>
  headers?: Array<{ name: string; version?: string }>
}

const archive = (
  name: string,
  chunks: ChunkSpec[],
  dependencies: Array<{ name: string; version: string }> = [],
  headers: string[] = [],
) => ({
  formatVersion: 1,
  manifest: {
    name,
    version: '1.0.0',
    namespace: name.replace(/-/g, '_'),
    functions: [],
    functionBlocks: chunks.map((c) => ({ name: c.name, inputs: [], outputs: [], inouts: [] })),
    types: [],
    headers,
    isBuiltin: false,
  },
  chunks: chunks.map((c) => ({
    name: c.name,
    kind: 'functionBlock',
    header: '',
    cpp: '',
    deps: c.deps ?? [],
    headers: c.headers ?? [],
  })),
  dependencies,
  sources: [],
  globalConstants: {},
})

/** A widget library: the element base needs the HMI core, a helper does not. */
const widgets = archive(
  'widgets',
  [{ name: 'HMIELEMENT', headers: [{ name: 'hmi_core.h', version: '1' }] }, { name: 'TEXTHELPER' }],
  [],
  ['hmi_core.h'],
)

/** A user library built against the widget library: a widget, a plain block, and a block that uses the helper. */
const mine = archive(
  'mine',
  [
    { name: 'MYWIDGET', deps: [{ library: 'widgets', name: 'HMIELEMENT' }] },
    { name: 'PLAIN' },
    { name: 'USESHELPER', deps: [{ library: 'widgets', name: 'TEXTHELPER' }] },
  ],
  [{ name: 'widgets', version: '1.0.0' }],
)

describe('projectLibraryNames', () => {
  it('lists the bundled libraries, then the listed ones, each once', () => {
    expect(projectLibraryNames(['iec', 'widgets'], ['mine', 'iec', 'oscat'])).toEqual([
      'iec',
      'widgets',
      'mine',
      'oscat',
    ])
  })
})

describe('selectProjectLibraryArchives', () => {
  it('keeps only the named archives, in the given order, the first of a name winning', () => {
    const shadow = { ...archive('mine', []), marker: true }
    const selected = selectProjectLibraryArchives([widgets, mine, shadow, archive('other', [])], ['mine', 'widgets'])
    expect(selected).toEqual([mine, widgets])
  })

  it('skips a name no archive has', () => {
    expect(selectProjectLibraryArchives([widgets], ['ghost', 'widgets'])).toEqual([widgets])
  })
})

describe('plcUnusablePous', () => {
  const requirements = libraryPouRequirements([widgets, mine])

  it('leaves out of a PLC build the POUs that need the HMI core, directly or through EXTENDS', () => {
    const unusable = plcUnusablePous(requirements, ['widgets', 'mine'])
    expect(unusablePouNames(unusable)).toEqual(['HMIELEMENT', 'MYWIDGET'])
    expect(unusable.get('mine')?.get('MYWIDGET')?.[0]).toMatch(/hmi_core\.h/)
  })

  it('also leaves out POUs of a library that reach a library the project does not use', () => {
    const unusable = plcUnusablePous(requirements, ['mine'])
    expect(unusablePouNames(unusable)).toEqual(['MYWIDGET', 'USESHELPER'])
    expect(unusable.get('mine')?.get('USESHELPER')?.join(' ')).toMatch(/library widgets/)
    expect(unusable.has('widgets')).toBe(false)
  })

  it('lets an HMI build use every POU', () => {
    expect(unusablePouNames(unusablePous(requirements, ['widgets', 'mine'], HMI_PROVIDED_HEADERS))).toEqual([])
  })

  it('answers the same selection from its cache', () => {
    expect(plcUnusablePous(requirements, ['mine'])).toBe(plcUnusablePous(requirements, ['mine']))
  })
})
