import type { InstalledPackage, PackageManifest } from '../../../../middleware/shared/ports/types'
import type { PackageManagerPort } from '../board-info-resolver'
import { findVppDeviceByBoardName } from '../find-vpp-device'

const pkg = (packageId: string): InstalledPackage =>
  ({ packageId, path: `/packages/${packageId}` }) as unknown as InstalledPackage

const manifest = (packageId: string, deviceNames: string[]): PackageManifest =>
  ({
    package: { id: packageId, name: packageId, version: '1.0.0' },
    devices: deviceNames.map((name) => ({ id: name.toLowerCase(), name, target: { type: 'runtime-v4' } })),
  }) as unknown as PackageManifest

/** A package source backed by plain in-memory maps. */
const source = (
  installed: InstalledPackage[],
  manifests: Record<string, PackageManifest | null>,
): PackageManagerPort => ({
  listInstalled: () => installed,
  getInstalledPackageManifest: (packageId) => manifests[packageId] ?? null,
})

describe('findVppDeviceByBoardName', () => {
  it('returns the package, manifest and device for a board a VPP provides', () => {
    const port = source([pkg('vendor.a')], { 'vendor.a': manifest('vendor.a', ['SLM-RP4', 'P2-722']) })
    const match = findVppDeviceByBoardName(port, 'P2-722')
    expect(match?.pkg.packageId).toBe('vendor.a')
    expect(match?.manifest.package.id).toBe('vendor.a')
    expect(match?.device.name).toBe('P2-722')
  })

  it('searches every installed package, not just the first', () => {
    const port = source([pkg('vendor.a'), pkg('vendor.b')], {
      'vendor.a': manifest('vendor.a', ['SLM-RP4']),
      'vendor.b': manifest('vendor.b', ['P2-722']),
    })
    expect(findVppDeviceByBoardName(port, 'P2-722')?.pkg.packageId).toBe('vendor.b')
  })

  it('returns null for a board no installed package provides', () => {
    const port = source([pkg('vendor.a')], { 'vendor.a': manifest('vendor.a', ['SLM-RP4']) })
    // The ordinary case: a built-in hals.json board with no VPP behind it.
    expect(findVppDeviceByBoardName(port, 'Arduino Uno')).toBeNull()
  })

  it('returns null when nothing is installed', () => {
    expect(findVppDeviceByBoardName(source([], {}), 'SLM-RP4')).toBeNull()
  })

  // The behaviour every copy of this loop shared and none of them stated.
  // Pinned here so a future change to it is a deliberate, single edit rather
  // than three sites drifting apart.
  it('takes the first match in listInstalled order when two packages collide', () => {
    const port = source([pkg('vendor.a'), pkg('vendor.b')], {
      'vendor.a': manifest('vendor.a', ['SLM-RP4']),
      'vendor.b': manifest('vendor.b', ['SLM-RP4']),
    })
    expect(findVppDeviceByBoardName(port, 'SLM-RP4')?.pkg.packageId).toBe('vendor.a')
  })

  it('skips a package whose manifest cannot be read and keeps searching', () => {
    // A single corrupt install must not hide a board another package provides.
    const port = source([pkg('vendor.broken'), pkg('vendor.b')], {
      'vendor.broken': null,
      'vendor.b': manifest('vendor.b', ['SLM-RP4']),
    })
    expect(findVppDeviceByBoardName(port, 'SLM-RP4')?.pkg.packageId).toBe('vendor.b')
  })

  it('matches on device name exactly', () => {
    const port = source([pkg('vendor.a')], { 'vendor.a': manifest('vendor.a', ['SLM-RP4']) })
    expect(findVppDeviceByBoardName(port, 'slm-rp4')).toBeNull()
    expect(findVppDeviceByBoardName(port, 'SLM-RP4 ')).toBeNull()
  })
})
