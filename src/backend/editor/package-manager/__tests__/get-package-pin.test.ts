import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { app } from 'electron'

// Same transitive-dependency stubs as the sibling integrity-gate suite.
jest.mock('electron', () => ({ app: { getPath: jest.fn(() => '/mock/path') } }))
jest.mock('extract-zip', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('../../services/logger-service', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}))

import { PackageManagerModule } from '../package-manager-module'

const PACKAGE_ID = 'com.test.pinned'
const VERSION = '1.0.0'

describe('PackageManagerModule.getPackagePin', () => {
  let userDataDir: string
  let packagesDir: string

  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'pkg-pin-'))
    packagesDir = join(userDataDir, 'packages')
    ;(app.getPath as jest.Mock).mockReturnValue(userDataDir)
  })

  afterEach(() => {
    jest.clearAllMocks()
    rmSync(userDataDir, { recursive: true, force: true })
  })

  /** Registers `packageId` in registry.json, pointing at a fresh package dir. */
  function registerPackage(packageId: string, version: string): string {
    const dir = join(packagesDir, packageId)
    mkdirSync(dir, { recursive: true })
    mkdirSync(packagesDir, { recursive: true })
    writeFileSync(
      join(packagesDir, 'registry.json'),
      JSON.stringify({
        formatVersion: '1.0',
        packages: { [packageId]: { version, installedAt: '2026-06-01T00:00:00.000Z', path: dir, devices: [] } },
      }),
    )
    return dir
  }

  const validSignature = (overrides: Record<string, unknown> = {}) => ({
    formatVersion: '1.0',
    alg: 'ed25519',
    keyId: 'test-key',
    packageId: PACKAGE_ID,
    version: VERSION,
    signedAt: '2026-06-01T00:00:00.000Z',
    files: { 'manifest.json': 'deadbeef' },
    signature: 'c29tZS1zaWduYXR1cmU=',
    ...overrides,
  })

  it('returns null for a package not in the registry', () => {
    expect(new PackageManagerModule().getPackagePin('com.test.absent')).toBeNull()
  })

  it('returns a pin whose identity matches signature.json and the registry entry', () => {
    const dir = registerPackage(PACKAGE_ID, VERSION)
    writeFileSync(join(dir, 'signature.json'), JSON.stringify(validSignature()))

    const pin = new PackageManagerModule().getPackagePin(PACKAGE_ID)

    expect(pin).toMatchObject({ packageId: PACKAGE_ID, version: VERSION })
    expect(pin?.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('refuses to pin an empty/malformed signature.json instead of hashing it', () => {
    // The exact regression this guards: `{}` used to parse as "an object" and
    // still produce a pin.
    const dir = registerPackage(PACKAGE_ID, VERSION)
    writeFileSync(join(dir, 'signature.json'), '{}')

    expect(new PackageManagerModule().getPackagePin(PACKAGE_ID)).toBeNull()
  })

  it('refuses to pin when signature.json declares a different packageId than the registry entry', () => {
    const dir = registerPackage(PACKAGE_ID, VERSION)
    writeFileSync(join(dir, 'signature.json'), JSON.stringify(validSignature({ packageId: 'com.test.other' })))

    expect(new PackageManagerModule().getPackagePin(PACKAGE_ID)).toBeNull()
  })

  it('refuses to pin when signature.json declares a different version than the registry entry', () => {
    const dir = registerPackage(PACKAGE_ID, VERSION)
    writeFileSync(join(dir, 'signature.json'), JSON.stringify(validSignature({ version: '9.9.9' })))

    expect(new PackageManagerModule().getPackagePin(PACKAGE_ID)).toBeNull()
  })

  it('returns null when the package has no signature.json (unsigned)', () => {
    registerPackage(PACKAGE_ID, VERSION)
    expect(new PackageManagerModule().getPackagePin(PACKAGE_ID)).toBeNull()
  })

  it('produces the same contentHash for the same signed payload every time (deterministic)', () => {
    const dir = registerPackage(PACKAGE_ID, VERSION)
    writeFileSync(join(dir, 'signature.json'), JSON.stringify(validSignature()))

    const first = new PackageManagerModule().getPackagePin(PACKAGE_ID)
    const second = new PackageManagerModule().getPackagePin(PACKAGE_ID)

    expect(first?.contentHash).toBe(second?.contentHash)
  })
})
