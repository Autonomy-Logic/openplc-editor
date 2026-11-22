import type { StlibArchiveDTO } from '../../../../middleware/shared/ports/library-port'

import { HMI_CORE_API_VERSION } from '../../../../middleware/shared/utils/hmi/widget-libraries'
import { bundledArchiveToInstalledRow, userArchiveToInstalledRow, withArchiveWarnings } from '../installed-library-rows'

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

/** An archive whose chunks need the HMI core at `version`. */
const coreArchive = (name: string, version: string): StlibArchiveDTO => ({
  ...makeArchive({ name }),
  ...{ chunks: [{ name: 'W', kind: 'functionBlock', deps: [], headers: [{ name: 'hmi_core.h', version }] }] },
})

describe('warning of a row', () => {
  const metadata = { name: 'extra-widgets', version: '1.0.0', installedAt: '', origin: 'stlib' as const }

  it('names the required and provided HMI core API of a library built for another one', () => {
    expect(
      userArchiveToInstalledRow(coreArchive('extra-widgets', String(HMI_CORE_API_VERSION + 1)), metadata).warning,
    ).toBe(
      `The library "extra-widgets" is left out of HMI builds: it is built for HMI core API ` +
        `${HMI_CORE_API_VERSION + 1}, but this editor provides HMI core API ${HMI_CORE_API_VERSION}. Install a build ` +
        `of the library for HMI core API ${HMI_CORE_API_VERSION}.`,
    )
  })

  it('is absent for a usable library', () => {
    expect('warning' in userArchiveToInstalledRow(coreArchive('w', String(HMI_CORE_API_VERSION)), metadata)).toBe(false)
    expect('warning' in bundledArchiveToInstalledRow(makeArchive({}))).toBe(false)
  })
})

describe('withArchiveWarnings', () => {
  it('adds the warning of each row whose archive HMI builds leave out, and leaves the others alone', () => {
    const row = (name: string) => ({ name, version: '1', bundled: false, installedAt: '', origin: 'stlib' as const })
    const rows = withArchiveWarnings(
      [row('old-widgets'), row('oscat-basic'), row('unread')],
      [coreArchive('old-widgets', String(HMI_CORE_API_VERSION + 1)), makeArchive({ name: 'oscat-basic' })],
    )
    expect(rows[0].warning).toContain('"old-widgets" is left out of HMI builds')
    expect(rows.slice(1)).toEqual([row('oscat-basic'), row('unread')])
  })
})
