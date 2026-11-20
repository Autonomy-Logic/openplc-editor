import {
  bundledLibraryNames,
  HMI_CORE_API_VERSION,
  HMI_CORE_HEADER,
  HMI_PROVIDED_HEADERS,
  hmiCoreApiMismatch,
  libraryArchiveWarning,
  parseWidgetsRelease,
  PLC_PROVIDED_HEADERS,
  type WidgetsRelease,
  widgetsReleaseProblems,
} from '../widget-libraries'

const core = String(HMI_CORE_API_VERSION)
const other = String(HMI_CORE_API_VERSION + 1)

/** An archive whose one chunk needs the HMI core at `version`, and whose manifest records it. */
const coreArchive = (name = 'dials', version = core) => ({
  manifest: { name, version: '1.0.0', headers: [HMI_CORE_HEADER], headerVersions: { [HMI_CORE_HEADER]: version } },
  chunks: [
    { name: 'HMIDIAL', kind: 'functionBlock', deps: [], headers: [{ name: HMI_CORE_HEADER, version }] },
    { name: 'DIAL_STYLE', kind: 'type', deps: [], headers: [] },
  ],
  dependencies: [],
})
const plainArchive = (name = 'alarms') => ({
  manifest: { name, version: '1.0.0', headers: [] },
  chunks: [{ name: 'ALARMS', kind: 'functionBlock', deps: [] }],
  dependencies: [],
})

describe('what builds provide', () => {
  it('gives HMI builds the HMI core at this API version and PLC builds nothing more than the runtime', () => {
    expect(HMI_PROVIDED_HEADERS).toEqual([{ name: 'hmi_core.h', version: core }])
    expect(PLC_PROVIDED_HEADERS).toEqual([])
  })

  it('names every pre-installed library as always on, with no kind', () => {
    const rows = [
      { name: 'iec-standard-fb', bundled: true },
      { name: 'standard-widgets', bundled: true },
      { name: 'hmi-alarms', bundled: true },
      { name: 'oscat-basic', bundled: false },
    ]
    expect(bundledLibraryNames(rows)).toEqual(['iec-standard-fb', 'standard-widgets', 'hmi-alarms'])
  })
})

describe('HMI core API of an archive', () => {
  it('finds no mismatch for this API, for a library that does not use the core, or for an archive of no shape', () => {
    expect(hmiCoreApiMismatch(coreArchive())).toBeNull()
    expect(hmiCoreApiMismatch(plainArchive())).toBeNull()
    expect(hmiCoreApiMismatch(null)).toBeNull()
    expect(libraryArchiveWarning(coreArchive())).toBeNull()
  })

  it('finds the version a chunk requires even when the manifest does not record it', () => {
    const archive = coreArchive('dials', other)
    const chunksOnly = { ...archive, manifest: { name: 'dials', version: '1.0.0', headers: [HMI_CORE_HEADER] } }
    expect(hmiCoreApiMismatch(chunksOnly)).toEqual({ name: 'dials', required: other, provided: core })
  })

  it('warns that HMI builds leave out a library built for another API, naming both versions', () => {
    expect(libraryArchiveWarning(coreArchive('dials', other))).toBe(
      `The library "dials" is left out of HMI builds: it is built for HMI core API ${other}, but this editor ` +
        `provides HMI core API ${core}. Install a build of the library for HMI core API ${core}.`,
    )
  })
})

describe('release manifest', () => {
  const sha = (c: string) => c.repeat(64)
  const release = (formatVersion = 2): WidgetsRelease => ({
    formatVersion,
    name: 'openplc-hmi-widgets',
    version: '1.1.0',
    strucppVersion: '0.8.1-rc2',
    archives: [
      {
        name: 'dials',
        displayName: 'Dials',
        version: '1.0.0',
        file: 'dials.stlib',
        sha256: sha('a'),
        size: 1,
        strucppVersion: '0.8.1-rc2',
        headers: ['hmi_core.h'],
        license: 'GPL-3.0-only',
      },
      {
        name: 'alarms',
        displayName: 'Alarms',
        version: '1.0.0',
        file: 'alarms.stlib',
        sha256: sha('b'),
        size: 1,
        strucppVersion: '0.8.1-rc2',
        headers: [],
        license: 'GPL-3.0-only',
      },
    ],
  })

  it('parses format 2, and format 1 without the kind and catalogue it carried', () => {
    expect(parseWidgetsRelease(JSON.stringify(release()))).toEqual(release())
    const v1 = release(1)
    const withKinds = {
      ...v1,
      archives: v1.archives.map((a) => ({ ...a, kind: 'hmi', hmiCoreApi: 1, catalog: { widgets: [], colors: [] } })),
    }
    expect(parseWidgetsRelease(JSON.stringify(withKinds))).toEqual(v1)
  })

  it('refuses another format version and a malformed manifest', () => {
    expect(() => parseWidgetsRelease(JSON.stringify(release(3)))).toThrow(
      'The HMI widget release manifest is format 3; this build reads formats 1 and 2',
    )
    expect(() => parseWidgetsRelease(JSON.stringify({ ...release(), archives: [{ name: 'x' }] }))).toThrow(
      'The HMI widget release manifest is invalid at archives.0',
    )
  })

  it('accepts files that match the manifest', () => {
    const files = [
      { file: 'dials.stlib', sha256: sha('a'), text: JSON.stringify(coreArchive()) },
      { file: 'alarms.stlib', sha256: sha('b'), text: JSON.stringify(plainArchive()) },
    ]
    expect(widgetsReleaseProblems(release(), files)).toEqual([])
  })

  it('reports a missing file, a hash mismatch, another library and a wrong core API', () => {
    expect(widgetsReleaseProblems(release(), [])).toEqual(['dials.stlib is missing', 'alarms.stlib is missing'])
    expect(
      widgetsReleaseProblems(release(), [
        { file: 'dials.stlib', sha256: sha('c'), text: '' },
        { file: 'alarms.stlib', sha256: sha('b'), text: JSON.stringify(coreArchive('other', other)) },
      ]),
    ).toEqual([
      `dials.stlib has SHA-256 ${sha('c')}, the manifest says ${sha('a')}`,
      'alarms.stlib is not the library alarms',
      `alarms.stlib is built for HMI core API ${other}, but this editor provides HMI core API ${core}`,
    ])
  })
})
