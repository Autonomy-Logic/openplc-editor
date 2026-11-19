import { selectBuildLibraryArchives, withLibraryKinds } from '../select-library-archives'

const plc = (name: string) => ({ manifest: { name } })
const hmi = (name: string) => ({ manifest: { name }, openplc: { formatVersion: 1, kind: 'hmi' } })

describe('selectBuildLibraryArchives', () => {
  const bundled = [plc('iec-standard-fb'), hmi('standard-widgets')]
  const installed = [
    { name: 'extra-widgets', archive: hmi('extra-widgets') },
    { name: 'oscat-basic', archive: plc('oscat-basic') },
    { name: 'broken', archive: null },
  ]
  const names = (r: { archives: Array<{ manifest: { name: string } }> }) => r.archives.map((a) => a.manifest.name)

  it('always builds with the pre-installed libraries and every installed widget library', () => {
    const result = selectBuildLibraryArchives(bundled, installed, [])
    expect(names(result)).toEqual(['iec-standard-fb', 'standard-widgets', 'extra-widgets'])
    expect(result.missing).toEqual([])
  })

  it('adds the PLC libraries the project enables, in its order, and reports those it cannot read', () => {
    const result = selectBuildLibraryArchives(bundled, installed, ['oscat-basic', 'broken', 'ghost', 'extra-widgets'])
    expect(names(result)).toEqual(['iec-standard-fb', 'standard-widgets', 'oscat-basic', 'extra-widgets'])
    expect(result.missing).toEqual(['broken', 'ghost'])
  })
})

describe('withLibraryKinds', () => {
  it('reads each row kind from its archive, and calls a library without metadata a PLC library', () => {
    const row = (name: string) => ({ name, version: '1', bundled: false, installedAt: '', origin: 'stlib' as const })
    expect(
      withLibraryKinds(
        [row('extra-widgets'), row('oscat-basic'), row('unknown')],
        [hmi('extra-widgets'), plc('oscat-basic')],
      ).map((r) => r.kind),
    ).toEqual(['hmi', 'plc', 'plc'])
  })
})
