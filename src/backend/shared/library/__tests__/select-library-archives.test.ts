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

  it('builds with the pre-installed libraries and every installed library', () => {
    const result = selectBuildLibraryArchives(bundled, installed, [])
    expect(names(result)).toEqual(['iec-standard-fb', 'standard-widgets', 'extra-widgets', 'oscat-basic'])
    expect(result.missing).toEqual([])
  })

  it('puts the libraries the project enables first, in its order, and reports those it cannot read', () => {
    const result = selectBuildLibraryArchives(bundled, installed, ['oscat-basic', 'broken', 'ghost', 'extra-widgets'])
    expect(names(result)).toEqual(['iec-standard-fb', 'standard-widgets', 'oscat-basic', 'extra-widgets'])
    expect(result.missing).toEqual(['broken', 'ghost'])
  })
})
