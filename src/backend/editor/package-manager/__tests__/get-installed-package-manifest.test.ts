import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { app } from 'electron'

// Same trimming as the signature suite: this module pulls in winston transports
// and extract-zip's ESM entry point that this suite has no use for.
jest.mock('electron', () => ({ app: { getPath: jest.fn(() => '/mock/path') } }))
jest.mock('extract-zip', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('../../services/logger-service', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}))

import { PackageManagerModule } from '../package-manager-module'

/**
 * `getInstalledPackageManifest` is the LOAD path, and every board provided by a
 * VPP resolves through it (`find-vpp-device` → `board-info-resolver` → the
 * compile pipeline). The install gate is allowed to refuse; this is not, beyond
 * a document that is not a manifest at all — a rejection here is a board
 * disappearing from the lookup with nothing said to the user.
 */
describe('PackageManagerModule.getInstalledPackageManifest — reading an installed package', () => {
  let userDataDir: string
  let packagesDir: string
  let warnSpy: jest.SpyInstance

  const manifestJson = (pkg: Record<string, unknown>) =>
    JSON.stringify({
      formatVersion: '1.0',
      package: { id: 'vendor.board', name: 'Vendor Board', version: '1.0.0', ...pkg },
      devices: [{ id: 'slm-rp4', name: 'SLM-RP4' }],
    })

  /** Write a package directory + registry entry, as an install would leave it. */
  function install(packageId: string, manifest: string): void {
    const dir = join(packagesDir, packageId)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'manifest.json'), manifest)
    writeFileSync(
      join(packagesDir, 'registry.json'),
      JSON.stringify({
        formatVersion: '1.0',
        packages: {
          [packageId]: { version: '1.0.0', installedAt: '2026-01-01T00:00:00Z', path: dir, devices: ['slm-rp4'] },
        },
      }),
    )
  }

  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'pkg-read-'))
    packagesDir = join(userDataDir, 'packages')
    ;(app.getPath as jest.Mock).mockReturnValue(userDataDir)
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
    jest.clearAllMocks()
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('returns the manifest of a package installed with a well-formed floor', () => {
    install('vendor.board', manifestJson({ minEditorVersion: '4.3' }))
    const manifest = new PackageManagerModule().getInstalledPackageManifest('vendor.board')
    expect(manifest?.package.minEditorVersion).toBe('4.3')
  })

  it('keeps resolving a package whose stored floor this editor cannot compare', () => {
    // The regression this guards: such a package was installed by an editor
    // predating the format check (DOPE-448). Rejecting its manifest on load
    // would unresolve its boards on upgrade, with no message anywhere.
    install('vendor.board', manifestJson({ minEditorVersion: 'nightly' }))

    const manifest = new PackageManagerModule().getInstalledPackageManifest('vendor.board')

    expect(manifest?.package.id).toBe('vendor.board')
    expect(manifest?.package).not.toHaveProperty('minEditorVersion')
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('minEditorVersion'))
  })

  it('still returns null for a document that is not a manifest', () => {
    install('vendor.board', JSON.stringify({ nothing: 'useful' }))
    expect(new PackageManagerModule().getInstalledPackageManifest('vendor.board')).toBeNull()
  })
})
