import type { StlibArchiveDTO } from '../../../../middleware/shared/ports/library-port'

import { bundledArchiveToInstalledRow, userArchiveToInstalledRow } from '../installed-library-rows'

function makeArchive(manifest: Partial<StlibArchiveDTO['manifest']>): StlibArchiveDTO {
  return {
    manifest: {
      name: 'sample-lib',
      version: '1.0.0',
      namespace: 'sample',
      isBuiltin: false,
      functions: [],
      functionBlocks: [],
      types: [],
      ...manifest,
    },
  }
}

describe('bundledArchiveToInstalledRow', () => {
  it('pins bundled=true / origin=bundled and clears installedAt', () => {
    expect(bundledArchiveToInstalledRow(makeArchive({ name: 'iec-std-functions', version: '2.0.0' }))).toEqual({
      name: 'iec-std-functions',
      version: '2.0.0',
      bundled: true,
      installedAt: '',
      origin: 'bundled',
    })
  })

  it('includes displayName + description when present', () => {
    const row = bundledArchiveToInstalledRow(
      makeArchive({
        name: 'oscat-basic',
        version: '3.3.5',
        displayName: 'OSCAT Basic',
        description: 'Open-source community automation toolkit',
      }),
    )
    expect(row.displayName).toBe('OSCAT Basic')
    expect(row.description).toBe('Open-source community automation toolkit')
  })

  it('omits displayName + description when absent (no undefined keys)', () => {
    const row = bundledArchiveToInstalledRow(makeArchive({ name: 'minimal', version: '0.1.0' }))
    expect('displayName' in row).toBe(false)
    expect('description' in row).toBe(false)
  })
})

describe('userArchiveToInstalledRow', () => {
  it('takes name + version from registry metadata, not the manifest', () => {
    // Editor convention: registry key wins over manifest in the rare
    // case they disagree.
    const archive = makeArchive({ name: 'manifest-name', version: '9.9.9' })
    const row = userArchiveToInstalledRow(archive, {
      name: 'registry-name',
      version: '1.2.3',
      installedAt: '2026-05-22T12:00:00Z',
      origin: 'stlib',
    })
    expect(row.name).toBe('registry-name')
    expect(row.version).toBe('1.2.3')
  })

  it('pins bundled=false and carries metadata through', () => {
    const row = userArchiveToInstalledRow(makeArchive({}), {
      name: 'user-lib',
      version: '0.1.0',
      installedAt: '2026-05-22T12:00:00Z',
      origin: 'codesys',
    })
    expect(row).toEqual({
      name: 'user-lib',
      version: '0.1.0',
      bundled: false,
      installedAt: '2026-05-22T12:00:00Z',
      origin: 'codesys',
    })
  })

  it('includes manifest displayName + description when present', () => {
    const row = userArchiveToInstalledRow(makeArchive({ displayName: 'User Lib', description: 'A user library' }), {
      name: 'user-lib',
      version: '0.1.0',
      installedAt: '2026-05-22T12:00:00Z',
      origin: 'stlib',
    })
    expect(row.displayName).toBe('User Lib')
    expect(row.description).toBe('A user library')
  })

  it('omits displayName + description when absent (no undefined keys)', () => {
    const row = userArchiveToInstalledRow(makeArchive({}), {
      name: 'user-lib',
      version: '0.1.0',
      installedAt: '2026-05-22T12:00:00Z',
      origin: 'stlib',
    })
    expect('displayName' in row).toBe(false)
    expect('description' in row).toBe(false)
  })
})
