import { createHash, sign as cryptoSign } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { app } from 'electron'

import { canonicalize, SIGNATURE_FILENAME } from '../../../shared/utils/vpp/verify-package-signature'

// Same transitive-dependency stubs as the sweep suite: winston file transports
// and extract-zip's ESM entry point are irrelevant to a signature check.
jest.mock('electron', () => ({ app: { getPath: jest.fn(() => '/mock/path') } }))
jest.mock('extract-zip', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('../../services/logger-service', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}))

// Swap the real trusted-key store for a generated test keypair so fixtures can
// be signed with a private key this suite holds. The factory cannot close over
// outer scope, so it generates inline and re-exports the private PEM.
jest.mock('../../../shared/utils/vpp/trusted-keys', () => {
  const { generateKeyPairSync } = jest.requireActual<typeof import('node:crypto')>('node:crypto')
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return {
    TRUSTED_PACKAGE_KEYS: { 'test-key': publicKey.export({ type: 'spki', format: 'pem' }).toString() },
    __TEST_PRIVATE_PEM: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  }
})

// eslint-disable-next-line @typescript-eslint/no-var-requires
const PRIVATE_PEM: string = (require('../../../shared/utils/vpp/trusted-keys') as { __TEST_PRIVATE_PEM: string })
  .__TEST_PRIVATE_PEM

import { formatPackageIntegrityError, PackageManagerModule } from '../package-manager-module'

const KEY_ID = 'test-key'
const BOARD_NAME = 'Test VPP Board'

const sha256 = (s: string): string =>
  createHash('sha256')
    .update(Uint8Array.from(Buffer.from(s, 'utf-8')))
    .digest('hex')

/** A manifest the installed-read path accepts, providing one named device. */
const manifestFor = (packageId: string): string =>
  JSON.stringify({
    formatVersion: '1.0',
    package: { id: packageId, name: 'Test Package', version: '1.0.0' },
    devices: [
      {
        id: 'test-device',
        name: BOARD_NAME,
        target: { type: 'runtime-v4' },
        hal: { pluginEntry: 'plugin/main.c' },
      },
    ],
  })

interface FixtureOpts {
  /** Extra files beyond manifest.json, keyed by package-relative POSIX path. */
  files?: Record<string, string>
  /** Override fields on the signed payload (e.g. a foreign keyId). */
  payloadOverride?: Record<string, unknown>
  /** Rewrite a file AFTER signing, to simulate a mid-session edit. */
  tamperFile?: { rel: string; content: string }
  /** Skip signature.json entirely (a hand-assembled package directory). */
  omitSignature?: boolean
}

describe('PackageManagerModule.verifyBoardPackageIntegrity', () => {
  let userDataDir: string
  let packagesDir: string

  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'pkg-build-gate-'))
    packagesDir = join(userDataDir, 'packages')
    ;(app.getPath as jest.Mock).mockReturnValue(userDataDir)
  })

  afterEach(() => {
    jest.clearAllMocks()
    rmSync(userDataDir, { recursive: true, force: true })
  })

  /** Write a signed package directory under packagesDir and register it. */
  function installFixture(packageId: string, opts: FixtureOpts = {}): string {
    const dir = join(packagesDir, packageId)
    const files: Record<string, string> = {
      'manifest.json': manifestFor(packageId),
      'plugin/main.c': 'int vpp_init(void) { return 0; }',
      ...opts.files,
    }

    const fileHashes: Record<string, string> = {}
    for (const [rel, content] of Object.entries(files)) {
      const full = join(dir, rel)
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, content)
      fileHashes[rel] = sha256(content)
    }

    if (!opts.omitSignature) {
      const payload = {
        formatVersion: '1.0',
        alg: 'ed25519',
        keyId: KEY_ID,
        packageId,
        version: '1.0.0',
        signedAt: '2026-06-01T00:00:00.000Z',
        files: fileHashes,
        ...opts.payloadOverride,
      }
      const signature = cryptoSign(
        null,
        Uint8Array.from(Buffer.from(canonicalize(payload), 'utf-8')),
        PRIVATE_PEM,
      ).toString('base64')
      writeFileSync(join(dir, SIGNATURE_FILENAME), JSON.stringify({ ...payload, signature }, null, 2))
    }

    if (opts.tamperFile) {
      writeFileSync(join(dir, opts.tamperFile.rel), opts.tamperFile.content)
    }

    mkdirSync(packagesDir, { recursive: true })
    writeFileSync(
      join(packagesDir, 'registry.json'),
      JSON.stringify(
        {
          formatVersion: '1.0',
          packages: {
            [packageId]: {
              version: '1.0.0',
              installedAt: '2026-06-01T00:00:00.000Z',
              path: dir,
              devices: ['test-device'],
            },
          },
        },
        null,
        2,
      ),
    )

    return dir
  }

  it('passes an untouched signed package — the negative control', () => {
    installFixture('com.test.valid')

    expect(new PackageManagerModule().verifyBoardPackageIntegrity(BOARD_NAME)).toEqual({ ok: true })
  })

  it('passes a board no installed package provides (built-in hals.json board)', () => {
    installFixture('com.test.valid')

    expect(new PackageManagerModule().verifyBoardPackageIntegrity('Arduino Uno')).toEqual({ ok: true })
  })

  it('passes when nothing is installed at all', () => {
    expect(new PackageManagerModule().verifyBoardPackageIntegrity(BOARD_NAME)).toEqual({ ok: true })
  })

  it('fails when the plugin payload was edited after installation', () => {
    // The DOPE-539 scenario for runtime-v4: vendor C that the runtime compiles
    // on the PLC, rewritten between project open and build.
    installFixture('com.test.tampered', {
      tamperFile: { rel: 'plugin/main.c', content: 'int vpp_init(void) { /* injected */ return 0; }' },
    })

    const result = new PackageManagerModule().verifyBoardPackageIntegrity(BOARD_NAME)

    expect(result).toEqual({
      ok: false,
      packageId: 'com.test.tampered',
      reason: expect.stringContaining('plugin/main.c'),
    })
  })

  it('fails when the manifest itself was edited after installation', () => {
    // The licensing-bypass shape: `capabilities.isLicensable` is a manifest
    // field, so an edit here is what the gate has to catch even though the
    // board still resolves.
    const dir = join(packagesDir, 'com.test.relicensed')
    installFixture('com.test.relicensed')
    writeFileSync(
      join(dir, 'manifest.json'),
      JSON.stringify({
        formatVersion: '1.0',
        package: { id: 'com.test.relicensed', name: 'Test Package', version: '1.0.0' },
        devices: [
          {
            id: 'test-device',
            name: BOARD_NAME,
            target: { type: 'runtime-v4' },
            hal: { pluginEntry: 'plugin/main.c' },
            capabilities: { isLicensable: false },
          },
        ],
      }),
    )

    const result = new PackageManagerModule().verifyBoardPackageIntegrity(BOARD_NAME)

    expect(result).toEqual({
      ok: false,
      packageId: 'com.test.relicensed',
      reason: expect.stringContaining('manifest.json'),
    })
  })

  it('fails when a file was added to the package after signing', () => {
    const dir = installFixture('com.test.injected')
    writeFileSync(join(dir, 'extra.c'), 'void backdoor(void) {}')

    const result = new PackageManagerModule().verifyBoardPackageIntegrity(BOARD_NAME)

    expect(result).toMatchObject({ ok: false, packageId: 'com.test.injected' })
  })

  it('fails when the package carries no signature at all', () => {
    installFixture('com.test.unsigned', { omitSignature: true })

    expect(new PackageManagerModule().verifyBoardPackageIntegrity(BOARD_NAME)).toEqual({
      ok: false,
      packageId: 'com.test.unsigned',
      reason: expect.stringContaining('not signed'),
    })
  })

  it('fails when the signature names a key the editor does not trust', () => {
    installFixture('com.test.selfsigned', { payloadOverride: { keyId: 'untrusted-key' } })

    expect(new PackageManagerModule().verifyBoardPackageIntegrity(BOARD_NAME)).toEqual({
      ok: false,
      packageId: 'com.test.selfsigned',
      reason: expect.stringContaining('untrusted-key'),
    })
  })

  it('fails when the package directory is gone but the registry entry is not', () => {
    const dir = installFixture('com.test.ghost')
    // Resolve the board while the files still exist, then remove them — the
    // registry entry alone must not be enough to build.
    rmSync(join(dir, 'plugin'), { recursive: true, force: true })

    expect(new PackageManagerModule().verifyBoardPackageIntegrity(BOARD_NAME)).toMatchObject({
      ok: false,
      packageId: 'com.test.ghost',
    })
    expect(existsSync(join(dir, 'manifest.json'))).toBe(true)
  })

  it('leaves the package on disk and in the registry — refusing is not removing', () => {
    const dir = installFixture('com.test.keep', { omitSignature: true })

    new PackageManagerModule().verifyBoardPackageIntegrity(BOARD_NAME)

    expect(existsSync(dir)).toBe(true)
    expect(new PackageManagerModule().listInstalled().map((p) => p.packageId)).toEqual(['com.test.keep'])
  })
})

describe('formatPackageIntegrityError', () => {
  it('names the board, the package, the reason and the remedy', () => {
    const message = formatPackageIntegrityError('Test VPP Board', {
      packageId: 'com.test.tampered',
      reason: 'Tampered file detected: plugin/main.c',
    })

    expect(message).toContain('Test VPP Board')
    expect(message).toContain('com.test.tampered')
    expect(message).toContain('Tampered file detected: plugin/main.c')
    expect(message).toContain('Reinstall the package')
  })
})
