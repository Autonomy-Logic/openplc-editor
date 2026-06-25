import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// app.getPath('userData') drives packagesDir/registryPath in the constructor.
// Point it at a per-test temp dir (mock-prefixed so jest's factory may close
// over it).
let mockUserData = ''
jest.mock('electron', () => ({ app: { getPath: () => mockUserData } }))

// Control the signature verdict directly — this suite verifies the gating
// logic (verify-on-use), not the Ed25519 crypto (covered by
// verify-package-signature.test.ts). Without a mock we'd need the private
// signing key.
const mockVerify = jest.fn()
jest.mock('../../../shared/utils/vpp/verify-package-signature', () => ({
  SIGNATURE_FILENAME: 'signature.json',
  verifyPackageSignature: (dir: string, keys: unknown) => mockVerify(dir, keys),
}))

// Keep the schema out of scope — return the raw JSON as-is so the test focuses
// on signature gating, not manifest shape (the schema has its own tests).
jest.mock('../../../../middleware/shared/ports/package-manifest-schema', () => ({
  PackageManifestSchema: { safeParse: (raw: unknown) => ({ success: true, data: raw }) },
}))

import { PackageManagerModule } from '../package-manager-module'

describe('PackageManagerModule signature re-verification (verify-on-use)', () => {
  const PKG_ID = 'com.test.board'
  let pm: PackageManagerModule
  let pkgDir: string

  const manifest = {
    formatVersion: '1.0',
    package: { id: PKG_ID, name: 'Test', version: '1.0.0', vendor: { name: 'x', logo: 'l.png' }, description: 'd' },
    devices: [{ id: 'b1', name: 'Board 1' }],
  }

  beforeEach(() => {
    mockUserData = mkdtempSync(join(tmpdir(), 'pm-verify-'))
    const packagesDir = join(mockUserData, 'packages')
    pkgDir = join(packagesDir, PKG_ID)
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(join(pkgDir, 'manifest.json'), JSON.stringify(manifest), 'utf-8')
    // A registry entry a user could have written by hand — the bypass under test.
    writeFileSync(
      join(packagesDir, 'registry.json'),
      JSON.stringify({
        formatVersion: '1.0',
        packages: { [PKG_ID]: { version: '1.0.0', installedAt: 'now', path: pkgDir, devices: ['b1'] } },
      }),
      'utf-8',
    )
    mockVerify.mockReset()
    pm = new PackageManagerModule()
  })

  afterEach(() => {
    rmSync(mockUserData, { recursive: true, force: true })
  })

  it('hides a registered package whose on-disk signature does not verify (manual-drop bypass closed)', () => {
    mockVerify.mockReturnValue({ valid: false, error: 'Untrusted signing key' })

    expect(pm.listInstalled()).toEqual([])
    expect(pm.getInstalledPackageManifest(PKG_ID)).toBeNull()
    // The verdict came from re-verifying the on-disk package, not the registry.
    expect(mockVerify).toHaveBeenCalledWith(pkgDir, expect.anything())
  })

  it('treats a verification throw as untrusted (fails closed)', () => {
    mockVerify.mockImplementation(() => {
      throw new Error('boom')
    })

    expect(pm.listInstalled()).toEqual([])
    expect(pm.getInstalledPackageManifest(PKG_ID)).toBeNull()
  })

  it('surfaces and reads a package that still verifies on disk', () => {
    mockVerify.mockReturnValue({ valid: true })

    expect(pm.listInstalled().map((p) => p.packageId)).toContain(PKG_ID)
    expect(pm.getInstalledPackageManifest(PKG_ID)?.package.id).toBe(PKG_ID)
  })
})
