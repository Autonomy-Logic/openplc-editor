import type { StlibArchiveDTO } from '../../../../middleware/shared/ports/library-port'
import { hmiLibraryBlocksOfArchives } from '../../../../middleware/shared/utils/hmi/plc-variables'
import {
  buildLibraryArchives,
  installedLibraryArchives,
  listedLibraryNames,
  loadBuildLibraryArchives,
  selectBuildLibraryArchives,
} from '../select-library-archives'

const lib = (name: string) => ({ manifest: { name } })

describe('selectBuildLibraryArchives', () => {
  const bundled = [lib('iec-standard-fb'), lib('standard-widgets')]
  const installed = [
    { name: 'extra-widgets', archive: lib('extra-widgets') },
    { name: 'oscat-basic', archive: lib('oscat-basic') },
    { name: 'broken', archive: null },
  ]
  const names = (r: { archives: Array<{ manifest: { name: string } }> }) => r.archives.map((a) => a.manifest.name)

  it('builds with the pre-installed libraries only when the project lists none', () => {
    const result = selectBuildLibraryArchives(bundled, installed, [])
    expect(names(result)).toEqual(['iec-standard-fb', 'standard-widgets'])
    expect(result.missing).toEqual([])
  })

  it('adds only the libraries the project lists, in its order, and never another installed library', () => {
    const result = selectBuildLibraryArchives(bundled, installed, ['oscat-basic'])
    expect(names(result)).toEqual(['iec-standard-fb', 'standard-widgets', 'oscat-basic'])
    expect(names(result)).not.toContain('extra-widgets')
  })

  it('reports the listed libraries it cannot read or that are not installed', () => {
    const result = selectBuildLibraryArchives(bundled, installed, ['oscat-basic', 'broken', 'ghost', 'extra-widgets'])
    expect(names(result)).toEqual(['iec-standard-fb', 'standard-widgets', 'oscat-basic', 'extra-widgets'])
    expect(result.missing).toEqual(['broken', 'ghost'])
  })
})

/** An archive whose library declares one function block, `Motor`, with one input pin. */
const motorLibrary = (name: string, pin: string): StlibArchiveDTO => ({
  manifest: {
    name,
    version: '1.0.0',
    namespace: name.replace(/-/g, '_'),
    isBuiltin: false,
    functions: [],
    functionBlocks: [{ name: 'Motor', inputs: [{ name: pin, type: 'BOOL' }], outputs: [], inouts: [] }],
    types: [],
  },
})

describe('loadBuildLibraryArchives', () => {
  const preinstalled = [motorLibrary('iec-standard-fb', 'IN')]

  it('does not load the user-installed archives when the project lists only pre-installed libraries', async () => {
    const loadInstalled = jest.fn(() => Promise.resolve([motorLibrary('listed', 'START')]))
    const none = await loadBuildLibraryArchives(preinstalled, loadInstalled, [])
    const bundledOnly = await loadBuildLibraryArchives(preinstalled, loadInstalled, ['iec-standard-fb'])
    expect(loadInstalled).not.toHaveBeenCalled()
    expect(none.archives).toEqual(preinstalled)
    expect(bundledOnly.archives).toEqual(preinstalled)
  })

  it('ignores an unlisted installed library, so its block of the same name does not override the listed one', async () => {
    const installed = [motorLibrary('listed', 'START'), motorLibrary('unlisted', 'OVERRIDE')]
    const result = await loadBuildLibraryArchives(preinstalled, () => Promise.resolve(installed), ['listed'])
    expect(result.archives.map((a) => a.manifest.name)).toEqual(['iec-standard-fb', 'listed'])
    expect(result.missing).toEqual([])
    expect(
      hmiLibraryBlocksOfArchives(result.archives)
        .get('MOTOR')
        ?.inputs.map((p) => p.name),
    ).toEqual(['START'])
    expect(
      hmiLibraryBlocksOfArchives([...preinstalled, ...installed])
        .get('MOTOR')
        ?.inputs.map((p) => p.name),
    ).toEqual(['OVERRIDE'])
  })

  it('reports a listed library that is not installed', async () => {
    const result = await loadBuildLibraryArchives(preinstalled, () => Promise.resolve([]), ['ghost'])
    expect(result.missing).toEqual(['ghost'])
  })
})

describe('installed archives as received', () => {
  it('names each archive by its manifest and fills in the manifest defaults', () => {
    const received: unknown[] = [{ manifest: { name: 'oscat', version: '3.3.5', namespace: 'oscat' }, chunks: [] }]
    expect(installedLibraryArchives(received)).toEqual([
      {
        name: 'oscat',
        archive: {
          manifest: {
            name: 'oscat',
            version: '3.3.5',
            namespace: 'oscat',
            isBuiltin: false,
            functions: [],
            functionBlocks: [],
            types: [],
          },
          chunks: [],
        },
      },
    ])
  })

  it('logs and leaves out a value that is not an archive', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(buildLibraryArchives([{ manifest: { name: 'no-version' } }, 'text'])).toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("archive 1 of 2 is not loaded: its manifest 'version'"))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('archive 2 of 2 is not loaded: it is not a JSON object'))
    warn.mockRestore()
  })

  it('lists the names a project lists, in its order', () => {
    expect(listedLibraryNames([{ name: 'b' }, { name: 'a' }])).toEqual(['b', 'a'])
    expect(listedLibraryNames(undefined)).toEqual([])
  })
})
