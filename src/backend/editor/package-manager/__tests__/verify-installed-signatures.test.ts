import { createHash, sign as cryptoSign } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { app } from 'electron'

import { canonicalize, SIGNATURE_FILENAME } from '../../../shared/utils/vpp/verify-package-signature'

// Heavy/side-effecting deps that the module pulls in transitively but this
// suite has no use for. Mocking them keeps `import { PackageManagerModule }`
// free of winston file transports and extract-zip's ESM entry point.
jest.mock('electron', () => ({ app: { getPath: jest.fn(() => '/mock/path') } }))
jest.mock('extract-zip', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('../../services/logger-service', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}))

import { TEST_AUTONOMY_KEY, testVerifyTrustedPackage } from '../../package-trust/__tests__/fixtures/trust-test-kit'
import { PackageManagerModule } from '../package-manager-module'

const verify = testVerifyTrustedPackage()

const KEY_ID = TEST_AUTONOMY_KEY.keyId

const sha256 = (s: string): string =>
  createHash('sha256')
    .update(Uint8Array.from(Buffer.from(s, 'utf-8')))
    .digest('hex')

interface FixtureOpts {
  files?: Record<string, string>
  /** Override fields on the signed payload (e.g. a foreign keyId). */
  payloadOverride?: Record<string, unknown>
  /** Mutate a file's bytes AFTER signing, to simulate tampering. */
  tamperFile?: { rel: string; content: string }
  /** Skip writing signature.json entirely (a side-loaded package). */
  omitSignature?: boolean
}

describe('PackageManagerModule.verifyInstalledSignatures', () => {
  let userDataDir: string
  let packagesDir: string

  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'pkg-sweep-'))
    packagesDir = join(userDataDir, 'packages')
    ;(app.getPath as jest.Mock).mockReturnValue(userDataDir)
  })

  afterEach(() => {
    jest.clearAllMocks()
    rmSync(userDataDir, { recursive: true, force: true })
  })

  /** Write a package directory under packagesDir and register it. */
  function installFixture(packageId: string, opts: FixtureOpts = {}): string {
    const dir = join(packagesDir, packageId)
    const version = (opts.payloadOverride?.version as string | undefined) ?? '1.0.0'
    const files = opts.files ?? {
      'manifest.json': JSON.stringify({ package: { id: packageId, version } }),
      'hal/arduino/hal.cpp': 'void hardwareInit() {}',
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
        version,
        signedAt: '2026-06-01T00:00:00.000Z',
        files: fileHashes,
        ...opts.payloadOverride,
      }
      const signature = cryptoSign(
        null,
        Uint8Array.from(Buffer.from(canonicalize(payload), 'utf-8')),
        TEST_AUTONOMY_KEY.privateKey,
      ).toString('base64')
      writeFileSync(join(dir, SIGNATURE_FILENAME), JSON.stringify({ ...payload, signature }, null, 2))
    }

    if (opts.tamperFile) {
      writeFileSync(join(dir, opts.tamperFile.rel), opts.tamperFile.content)
    }

    return dir
  }

  /** Write registry.json with the given packageId -> path entries. */
  function writeRegistry(entries: Record<string, { path: string }>): void {
    mkdirSync(packagesDir, { recursive: true })
    const packages: Record<string, unknown> = {}
    for (const [id, e] of Object.entries(entries)) {
      packages[id] = { version: '1.0.0', installedAt: '2026-06-01T00:00:00.000Z', path: e.path, devices: [] }
    }
    writeFileSync(join(packagesDir, 'registry.json'), JSON.stringify({ formatVersion: '1.0', packages }, null, 2))
  }

  function readRegistryIds(): string[] {
    const raw = JSON.parse(require('node:fs').readFileSync(join(packagesDir, 'registry.json'), 'utf-8')) as {
      packages: Record<string, unknown>
    }
    return Object.keys(raw.packages)
  }

  it('keeps a package that is validly signed by a trusted key', () => {
    const dir = installFixture('com.test.valid')
    writeRegistry({ 'com.test.valid': { path: dir } })

    const warn = jest.fn()
    const removed = new PackageManagerModule(verify).verifyInstalledSignatures(warn)

    expect(removed).toEqual([])
    expect(warn).not.toHaveBeenCalled()
    expect(existsSync(dir)).toBe(true)
    expect(readRegistryIds()).toEqual(['com.test.valid'])
  })

  it('removes a package that has no signature.json', () => {
    const dir = installFixture('com.test.unsigned', { omitSignature: true })
    writeRegistry({ 'com.test.unsigned': { path: dir } })

    const warn = jest.fn()
    const removed = new PackageManagerModule(verify).verifyInstalledSignatures(warn)

    expect(removed).toEqual(['com.test.unsigned'])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('com.test.unsigned'))
    expect(existsSync(dir)).toBe(false)
    expect(readRegistryIds()).toEqual([])
  })

  it('removes a package whose signature names an untrusted key', () => {
    const dir = installFixture('com.test.selfsigned', { payloadOverride: { keyId: 'untrusted-key' } })
    writeRegistry({ 'com.test.selfsigned': { path: dir } })

    const removed = new PackageManagerModule(verify).verifyInstalledSignatures(jest.fn())

    expect(removed).toEqual(['com.test.selfsigned'])
    expect(existsSync(dir)).toBe(false)
  })

  it('removes a package whose files were tampered after signing', () => {
    const dir = installFixture('com.test.tampered', {
      tamperFile: { rel: 'hal/arduino/hal.cpp', content: 'void hardwareInit() { /* altered */ }' },
    })
    writeRegistry({ 'com.test.tampered': { path: dir } })

    const removed = new PackageManagerModule(verify).verifyInstalledSignatures(jest.fn())

    expect(removed).toEqual(['com.test.tampered'])
    expect(existsSync(dir)).toBe(false)
  })

  it('drops a stale registry entry whose directory is missing', () => {
    writeRegistry({ 'com.test.ghost': { path: join(packagesDir, 'com.test.ghost') } })

    const removed = new PackageManagerModule(verify).verifyInstalledSignatures(jest.fn())

    expect(removed).toEqual(['com.test.ghost'])
    expect(readRegistryIds()).toEqual([])
  })

  it('de-lists an out-of-tree registry path without touching disk', () => {
    // Registry path outside packagesDir: the entry is dropped and files there
    // are left untouched.
    const outside = mkdtempSync(join(tmpdir(), 'outside-'))
    writeFileSync(join(outside, 'keepme.txt'), 'data')
    writeRegistry({ 'com.test.escape': { path: outside } })

    const removed = new PackageManagerModule(verify).verifyInstalledSignatures(jest.fn())

    expect(removed).toEqual(['com.test.escape'])
    expect(readRegistryIds()).toEqual([])
    expect(existsSync(join(outside, 'keepme.txt'))).toBe(true)
    rmSync(outside, { recursive: true, force: true })
  })

  it('removes only the invalid package in a mixed registry', () => {
    const good = installFixture('com.test.good')
    const bad = installFixture('com.test.bad', { omitSignature: true })
    writeRegistry({ 'com.test.good': { path: good }, 'com.test.bad': { path: bad } })

    const removed = new PackageManagerModule(verify).verifyInstalledSignatures(jest.fn())

    expect(removed).toEqual(['com.test.bad'])
    expect(existsSync(good)).toBe(true)
    expect(existsSync(bad)).toBe(false)
    expect(readRegistryIds()).toEqual(['com.test.good'])
  })
})
