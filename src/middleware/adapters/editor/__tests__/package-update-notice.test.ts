/**
 * The build-time "a newer package exists" notice.
 *
 * What these pin is mostly about restraint: the notice must never delay a
 * build, never fail one, and never point at a version the editor would refuse
 * to install. Recency alone is not a reason to mention a release.
 */

import type { InstalledPackage, RemoteCatalog, RemoteCatalogEntry } from '../../../shared/ports/types'
import { createPackageUpdateNotifier, findPackageUpdate, formatPackageUpdateNotice } from '../package-update-notice'

const entry = (overrides: Partial<RemoteCatalogEntry> = {}): RemoteCatalogEntry => ({
  packageId: 'com.openplc.arduino',
  name: 'Arduino Boards',
  vendor: { name: 'Arduino' },
  description: 'Arduino boards',
  // Newest-first, as the catalog contract states.
  versions: [
    { version: '1.3.0', downloadUrl: 'u3', deviceCount: 4 },
    { version: '1.2.0', downloadUrl: 'u2', deviceCount: 4 },
    { version: '1.1.0', downloadUrl: 'u1', deviceCount: 4 },
  ],
  ...overrides,
})

const catalog = (...entries: RemoteCatalogEntry[]): RemoteCatalog => ({
  entries,
  fetchedAt: '2026-09-15T00:00:00.000Z',
})

describe('findPackageUpdate', () => {
  it('reports the newest release when it is ahead of what is installed', () => {
    expect(findPackageUpdate(catalog(entry()), 'com.openplc.arduino', '1.1.0', '4.3.0')).toEqual({
      packageName: 'Arduino Boards',
      installedVersion: '1.1.0',
      availableVersion: '1.3.0',
    })
  })

  it('skips releases this editor could not install, and offers the newest one it could', () => {
    // Naming 1.3.0 here would send the user to the Package Manager to be told
    // the editor is too old -- the same `minEditorVersion` floor gates both.
    const versions = [
      { version: '1.3.0', downloadUrl: 'u3', deviceCount: 4, minEditorVersion: '4.5.0' },
      { version: '1.2.0', downloadUrl: 'u2', deviceCount: 4, minEditorVersion: '4.3.0' },
      { version: '1.1.0', downloadUrl: 'u1', deviceCount: 4 },
    ]
    expect(findPackageUpdate(catalog(entry({ versions })), 'com.openplc.arduino', '1.1.0', '4.3.0')).toEqual({
      packageName: 'Arduino Boards',
      installedVersion: '1.1.0',
      availableVersion: '1.2.0',
    })
  })

  it('says nothing when every release needs a newer editor', () => {
    const versions = [{ version: '2.0.0', downloadUrl: 'u', deviceCount: 4, minEditorVersion: '9.0.0' }]
    expect(findPackageUpdate(catalog(entry({ versions })), 'com.openplc.arduino', '1.1.0', '4.3.0')).toBeNull()
  })

  it('says nothing when the installed version is already the newest, or ahead of it', () => {
    expect(findPackageUpdate(catalog(entry()), 'com.openplc.arduino', '1.3.0', '4.3.0')).toBeNull()
    expect(findPackageUpdate(catalog(entry()), 'com.openplc.arduino', '2.0.0', '4.3.0')).toBeNull()
  })

  it('says nothing about a package the catalog does not carry, or with no catalog at all', () => {
    expect(findPackageUpdate(catalog(entry()), 'com.vendor.private', '1.0.0', '4.3.0')).toBeNull()
    expect(findPackageUpdate(null, 'com.openplc.arduino', '1.1.0', '4.3.0')).toBeNull()
  })
})

describe('formatPackageUpdateNotice', () => {
  it('names both versions and where to act on it', () => {
    const message = formatPackageUpdateNotice({
      packageName: 'Arduino Boards',
      installedVersion: '1.1.0',
      availableVersion: '1.3.0',
    })
    expect(message).toContain('Arduino Boards')
    expect(message).toContain('1.1.0 -> 1.3.0')
    expect(message).toContain('Package Manager')
  })
})

describe('createPackageUpdateNotifier', () => {
  const installed: InstalledPackage[] = [
    { packageId: 'com.openplc.arduino', version: '1.1.0', installedAt: '', path: '', devices: [] },
  ]

  it('answers from the catalog fetched at prime time, with no further network', async () => {
    const listRemoteCatalog = jest.fn().mockResolvedValue(catalog(entry()))
    const notifier = createPackageUpdateNotifier(
      { listRemoteCatalog, listInstalled: jest.fn().mockResolvedValue(installed) },
      '4.3.0',
    )

    await notifier.prime()
    expect(await notifier.notice('com.openplc.arduino')).toContain('1.1.0 -> 1.3.0')
    expect(await notifier.notice('com.openplc.arduino')).toContain('1.1.0 -> 1.3.0')
    // The whole design rests on this: one fetch, every build after it free.
    expect(listRemoteCatalog).toHaveBeenCalledTimes(1)
  })

  it('stays silent, rather than failing, when the catalog could not be fetched', async () => {
    // Offline is the normal case for a shop-floor machine, not an error to report.
    const listInstalled = jest.fn().mockResolvedValue(installed)
    const notifier = createPackageUpdateNotifier(
      { listRemoteCatalog: jest.fn().mockRejectedValue(new Error('ENOTFOUND')), listInstalled },
      '4.3.0',
    )

    await expect(notifier.prime()).resolves.toBeUndefined()
    expect(await notifier.notice('com.openplc.arduino')).toBeNull()
    // Nothing was fetched, so there is nothing to compare against and the
    // build does not even pay for the local read.
    expect(listInstalled).not.toHaveBeenCalled()
  })

  it('stays silent before prime has resolved', async () => {
    const notifier = createPackageUpdateNotifier(
      { listRemoteCatalog: jest.fn().mockResolvedValue(catalog(entry())), listInstalled: jest.fn() },
      '4.3.0',
    )
    expect(await notifier.notice('com.openplc.arduino')).toBeNull()
  })

  it('stays silent when the board came from a package that is not installed', async () => {
    const notifier = createPackageUpdateNotifier(
      {
        listRemoteCatalog: jest.fn().mockResolvedValue(catalog(entry())),
        listInstalled: jest.fn().mockResolvedValue([]),
      },
      '4.3.0',
    )
    await notifier.prime()
    expect(await notifier.notice('com.openplc.arduino')).toBeNull()
  })

  it('swallows a failure reading the installed list, so a build is never lost to a notice', async () => {
    const notifier = createPackageUpdateNotifier(
      {
        listRemoteCatalog: jest.fn().mockResolvedValue(catalog(entry())),
        listInstalled: jest.fn().mockRejectedValue(new Error('IPC gone')),
      },
      '4.3.0',
    )
    await notifier.prime()
    expect(await notifier.notice('com.openplc.arduino')).toBeNull()
  })

  it('reads the installed version per call, so an install mid-session is reflected at once', async () => {
    const listInstalled = jest
      .fn()
      .mockResolvedValueOnce(installed)
      .mockResolvedValueOnce([
        { packageId: 'com.openplc.arduino', version: '1.3.0', installedAt: '', path: '', devices: [] },
      ])
    const notifier = createPackageUpdateNotifier(
      { listRemoteCatalog: jest.fn().mockResolvedValue(catalog(entry())), listInstalled },
      '4.3.0',
    )

    await notifier.prime()
    expect(await notifier.notice('com.openplc.arduino')).toContain('1.1.0 -> 1.3.0')
    expect(await notifier.notice('com.openplc.arduino')).toBeNull()
  })
})
