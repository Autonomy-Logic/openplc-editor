import {
  bundledLibraryNames,
  HMI_CORE_API_VERSION,
  HMI_CORE_HEADER,
  HMI_PROVIDED_HEADERS,
  hmiCoreApiMismatch,
  libraryArchiveWarning,
  parseWidgetsReleaseSums,
  PLC_PROVIDED_HEADERS,
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

describe('release checksum list', () => {
  const sha = (c: string) => c.repeat(64)
  const entries = [
    { file: 'LICENSE', sha256: sha('f') },
    { file: 'alarms.stlib', sha256: sha('b') },
    { file: 'dials.stlib', sha256: sha('a') },
  ]

  it('parses sha256sum lines, text and binary mode', () => {
    expect(
      parseWidgetsReleaseSums(`${sha('f')}  LICENSE\n${sha('b')} *alarms.stlib\n${sha('a')}  dials.stlib\n`),
    ).toEqual(entries)
  })

  it('refuses a malformed line, a path, a file listed twice and a list with no archive', () => {
    expect(() => parseWidgetsReleaseSums(`${sha('a')} dials.stlib\n`)).toThrow('SHA256SUMS line 1 is not')
    expect(() => parseWidgetsReleaseSums(`${sha('a')}  ../dials.stlib\n`)).toThrow('SHA256SUMS line 1 is not')
    expect(() => parseWidgetsReleaseSums(`${sha('a')}  a/dials.stlib\n`)).toThrow('SHA256SUMS line 1 is not')
    expect(() => parseWidgetsReleaseSums(`${sha('a')}  dials.stlib\n${sha('b')}  dials.stlib\n`)).toThrow(
      'SHA256SUMS lists dials.stlib twice',
    )
    expect(() => parseWidgetsReleaseSums(`${sha('f')}  LICENSE\n`)).toThrow('SHA256SUMS lists no .stlib archive')
  })

  it('accepts files that match the list', () => {
    const files = [
      { file: 'LICENSE', sha256: sha('f'), text: 'GPLv3' },
      { file: 'dials.stlib', sha256: sha('a'), text: JSON.stringify(coreArchive()) },
      { file: 'alarms.stlib', sha256: sha('b'), text: JSON.stringify(plainArchive()) },
    ]
    expect(widgetsReleaseProblems(entries, files)).toEqual([])
  })

  it('reports a missing file, a hash mismatch, another library and a wrong core API', () => {
    expect(widgetsReleaseProblems(entries, [])).toEqual([
      'LICENSE is missing',
      'alarms.stlib is missing',
      'dials.stlib is missing',
    ])
    expect(
      widgetsReleaseProblems(entries, [
        { file: 'LICENSE', sha256: sha('f'), text: 'not JSON, not an archive' },
        { file: 'dials.stlib', sha256: sha('c'), text: '' },
        { file: 'alarms.stlib', sha256: sha('b'), text: JSON.stringify(coreArchive('other', other)) },
      ]),
    ).toEqual([
      'alarms.stlib is not the library alarms',
      `alarms.stlib is built for HMI core API ${other}, but this editor provides HMI core API ${core}`,
      `dials.stlib has SHA-256 ${sha('c')}, SHA256SUMS says ${sha('a')}`,
    ])
  })
})
