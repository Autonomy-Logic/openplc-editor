import {
  bundledPlcLibraryNames,
  HMI_CORE_API_VERSION,
  hmiLibraryCatalog,
  libraryArchiveProblem,
  libraryKind,
  partitionLibraryArchives,
  parseWidgetsRelease,
  readLibraryMetadata,
  type WidgetsRelease,
  widgetsReleaseProblems,
} from '../widget-libraries'

const widget = {
  name: 'HmiDial',
  library: 'dials',
  extends: 'HMIELEMENT',
  palette: 'Display',
  properties: [{ name: 'Value', type: 'REAL', kind: 'number', group: 'data', declaredBy: 'HmiDial' }],
  outputs: [],
  main: { name: 'Value', direction: 'input', type: 'REAL' },
  events: [],
}

const hmiArchive = (name = 'dials', hmiCoreApi = HMI_CORE_API_VERSION) => ({
  manifest: { name, version: '1.0.0' },
  openplc: {
    formatVersion: 1,
    kind: 'hmi',
    license: 'GPL-3.0-only',
    hmiCoreApi,
    catalog: { widgets: [widget], colors: ['Background'] },
  },
})
const plcArchive = (name = 'alarms') => ({
  manifest: { name, version: '1.0.0' },
  openplc: { formatVersion: 1, kind: 'plc', license: 'GPL-3.0-only' },
})
const bareArchive = (name = 'oscat') => ({ manifest: { name, version: '1.0.0' } })

describe('library kinds', () => {
  it('reads the kind an archive declares; an archive without metadata is a PLC library', () => {
    expect(libraryKind(hmiArchive())).toBe('hmi')
    expect(libraryKind(plcArchive())).toBe('plc')
    expect(libraryKind(bareArchive())).toBe('plc')
    expect(libraryKind(null)).toBe('plc')
  })

  it('splits archives into PLC and widget libraries, keeping their order', () => {
    const [a, b, c, d] = [bareArchive('a'), hmiArchive('b'), plcArchive('c'), hmiArchive('d')]
    expect(partitionLibraryArchives([a, b, c, d])).toEqual({ plc: [a, c], hmi: [b, d] })
  })

  it('names only the pre-installed PLC libraries as always on for PLC code', () => {
    const rows = [
      { name: 'iec-standard-fb', bundled: true },
      { name: 'standard-widgets', bundled: true, kind: 'hmi' as const },
      { name: 'hmi-alarms', bundled: true, kind: 'plc' as const },
      { name: 'oscat-basic', bundled: false, kind: 'plc' as const },
    ]
    expect(bundledPlcLibraryNames(rows)).toEqual(['iec-standard-fb', 'hmi-alarms'])
  })
})

describe('library metadata', () => {
  it('accepts a widget library built for this core API and gives its catalogue by upper-case name', () => {
    expect(libraryArchiveProblem(hmiArchive())).toBeNull()
    const catalog = hmiLibraryCatalog(hmiArchive())
    expect(catalog?.colors).toEqual(['Background'])
    expect(catalog?.widgets.get('HMIDIAL')).toMatchObject({ name: 'HmiDial', palette: 'Display' })
    expect(hmiLibraryCatalog(plcArchive())).toBeNull()
  })

  it('refuses a widget library built for another core API, saying which one to install', () => {
    expect(libraryArchiveProblem(hmiArchive('dials', HMI_CORE_API_VERSION + 1))).toBe(
      `The widget library "dials" is built for HMI core API ${HMI_CORE_API_VERSION + 1}, but this editor provides ` +
        `HMI core API ${HMI_CORE_API_VERSION}. Install a build of the library for HMI core API ${HMI_CORE_API_VERSION}.`,
    )
    expect(hmiLibraryCatalog(hmiArchive('dials', HMI_CORE_API_VERSION + 1))).toBeNull()
  })

  it('refuses metadata of an unknown format or shape', () => {
    const future = { ...plcArchive(), openplc: { formatVersion: 2, kind: 'plc' } }
    expect(libraryArchiveProblem(future)).toContain('uses library metadata format 2')
    const broken = { ...hmiArchive(), openplc: { formatVersion: 1, kind: 'hmi', license: 'x', hmiCoreApi: 1 } }
    expect(libraryArchiveProblem(broken)).toContain('carries invalid OpenPLC metadata')
    expect(readLibraryMetadata(bareArchive())).toEqual({ ok: true, metadata: null })
  })
})

describe('release manifest', () => {
  const sha = (c: string) => c.repeat(64)
  const release = (): WidgetsRelease => ({
    formatVersion: 1,
    name: 'openplc-hmi-widgets',
    version: '1.0.0',
    strucppVersion: '0.8.1-rc1',
    archives: [
      {
        name: 'dials',
        displayName: 'Dials',
        version: '1.0.0',
        kind: 'hmi',
        file: 'dials.stlib',
        sha256: sha('a'),
        size: 1,
        strucppVersion: '0.8.1-rc1',
        headers: ['hmi_core.h'],
        license: 'GPL-3.0-only',
        hmiCoreApi: HMI_CORE_API_VERSION,
        catalog: { widgets: [], colors: [] },
      },
      {
        name: 'alarms',
        displayName: 'Alarms',
        version: '1.0.0',
        kind: 'plc',
        file: 'alarms.stlib',
        sha256: sha('b'),
        size: 1,
        strucppVersion: '0.8.1-rc1',
        headers: [],
        license: 'GPL-3.0-only',
      },
    ],
  })

  it('parses a release manifest and refuses another format version', () => {
    expect(parseWidgetsRelease(JSON.stringify(release()))).toEqual(release())
    expect(() => parseWidgetsRelease(JSON.stringify({ ...release(), formatVersion: 2 }))).toThrow(
      'The HMI widget release manifest is format 2; this build reads format 1',
    )
    expect(() => parseWidgetsRelease(JSON.stringify({ ...release(), archives: [{ name: 'x' }] }))).toThrow(
      'The HMI widget release manifest is invalid at archives.0',
    )
  })

  it('accepts files that match the manifest', () => {
    const files = [
      { file: 'dials.stlib', sha256: sha('a'), text: JSON.stringify(hmiArchive()) },
      { file: 'alarms.stlib', sha256: sha('b'), text: JSON.stringify(plcArchive()) },
    ]
    expect(widgetsReleaseProblems(release(), files)).toEqual([])
  })

  it('reports a missing file, a hash mismatch, a contradicting kind and a wrong core API', () => {
    expect(widgetsReleaseProblems(release(), [])).toEqual(['dials.stlib is missing', 'alarms.stlib is missing'])
    expect(
      widgetsReleaseProblems(release(), [
        { file: 'dials.stlib', sha256: sha('c'), text: '' },
        {
          file: 'alarms.stlib',
          sha256: sha('b'),
          text: JSON.stringify(hmiArchive('alarms', HMI_CORE_API_VERSION + 1)),
        },
      ]),
    ).toEqual([
      `dials.stlib has SHA-256 ${sha('c')}, the manifest says ${sha('a')}`,
      'alarms.stlib is not of kind plc',
      expect.stringContaining(`is built for HMI core API ${HMI_CORE_API_VERSION + 1}`),
    ])
  })
})
