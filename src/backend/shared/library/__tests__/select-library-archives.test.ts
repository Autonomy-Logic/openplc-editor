import { selectBuildLibraryArchives } from '../select-library-archives'

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
