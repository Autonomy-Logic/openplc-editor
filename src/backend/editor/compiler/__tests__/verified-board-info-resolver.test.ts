/**
 * VPP package-signature enforcement on the BUILD path (security audit
 * finding #2 / task #39).
 *
 * The threat: signature verification used to run only at import time and in
 * the open-project sweep. Nothing re-checked the package at compile time, and
 * the package decides which prebuilt archive links, which HAL `.cpp` compiles,
 * which license-store backends get injected into the sketch, and every
 * compiler/linker flag. So editing an already-installed package on disk —
 * dropping the closed license-core `.a` and supplying your own
 * `updateInput/OutputBuffers` — produced a clean build and a clean flash of
 * unlicensed firmware.
 *
 * Two layers are asserted here:
 *   1. `VerifiedBoardInfoResolver` — the resolver every compile path uses
 *      refuses to hand out build info for a package that no longer matches
 *      its signature.
 *   2. `CompilerModule.compileProgram` — the real entrypoint aborts with the
 *      refusal message and never reaches the toolchain. This is the assertion
 *      that actually fails if the resolver stops being wired into the build
 *      path, which is exactly the shape of the original bug.
 */

import { createHash, sign as cryptoSign } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { app } from 'electron'

import type { InstalledPackage, PackageManifest } from '../../../../middleware/shared/ports/types'
import type { HalsFileContent, PackageManagerPort } from '../../../shared/hardware/board-info-resolver'
import { canonicalize, SIGNATURE_FILENAME } from '../../../shared/utils/vpp/verify-package-signature'

// The compiler module reaches for the Electron app in its constructor, and
// pulls in extract-zip (ESM entry) + the winston-backed logger transitively
// through the package manager. Neither is exercised here.
jest.mock('electron', () => {
  const os = jest.requireActual<typeof import('node:os')>('node:os')
  return {
    app: { getPath: jest.fn(() => os.tmpdir()), getAppPath: jest.fn(() => os.tmpdir()) },
    dialog: {},
    MessageChannelMain: class {},
  }
})
jest.mock('extract-zip', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('../../services/logger-service', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}))

// Swap the shipped trust anchor for a keypair the test actually holds, so
// fixtures can be genuinely signed instead of stubbing the verifier out. The
// factory can't close over outer scope, so it re-exports the private PEM.
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

const BUILTIN_BOARD = 'OpenPLC Runtime v4'
const VPP_BOARD = 'Test ESP32 (licensed)'
const PACKAGE_ID = 'com.test.espressif-licensed'

const HALS: HalsFileContent = {
  [BUILTIN_BOARD]: { compiler: 'openplc-compiler' },
}

// hals.json is read by compileProgram directly and again inside the resolver
// factory; both go through this loader.
jest.mock('@root/backend/shared/firmware/hals-loader', () => ({
  readHalsFile: jest.fn(async () => ({ [BUILTIN_BOARD]: { compiler: 'openplc-compiler' } })),
}))

// eslint-disable-next-line import/first
import { CompilerModule } from '../compiler-module'
// eslint-disable-next-line import/first
import { VerifiedBoardInfoResolver, VppPackageSignatureError } from '../verified-board-info-resolver'

const sha256 = (content: string): string =>
  createHash('sha256')
    .update(Uint8Array.from(Buffer.from(content, 'utf-8')))
    .digest('hex')

/** Manifest whose single device is the VPP board under test. */
function manifestFor(packageId: string): PackageManifest {
  return {
    formatVersion: '1.0',
    package: {
      id: packageId,
      name: 'Test Espressif (licensed)',
      version: '1.0.0',
      vendor: { name: 'OpenPLC', logo: 'logo.png' },
      description: 'fixture',
    },
    devices: [
      {
        id: 'esp32-licensed',
        name: VPP_BOARD,
        preview: 'preview.png',
        target: { type: 'arduino-cli', platform: 'esp32:esp32:esp32', core: 'esp32:esp32' },
        hal: {
          type: 'arduino-hal',
          source: 'hal/arduino/esp32.cpp',
          licenseStore: ['hal/arduino/license_store_esp32.cpp'],
          precompiledLibrary: 'hal/arduino/lib',
        },
      },
    ],
  } as unknown as PackageManifest
}

/**
 * The files that make up the fixture package. `manifest.json` matters because
 * the real `PackageManagerModule` re-reads it off disk.
 */
function packageFiles(packageId: string): Record<string, string> {
  return {
    'manifest.json': JSON.stringify(manifestFor(packageId), null, 2),
    'hal/arduino/esp32.cpp': 'void hal_read_inputs(void) {}\n',
    'hal/arduino/license_store_esp32.cpp': 'lic_store_status_t license_store_read(void) { return 0; }\n',
    'hal/arduino/lib/src/esp32/libvendor.a': 'ARCHIVE-BYTES-STANDING-IN-FOR-THE-LICENSE-CORE\n',
  }
}

interface FixtureOpts {
  /** Rewrite a file AFTER signing — the on-disk tamper the audit describes. */
  tamperFile?: { rel: string; content: string }
  /** Add a file that the signature never covered. */
  injectFile?: { rel: string; content: string }
  /** Ship no signature.json at all (hand-placed package directory). */
  omitSignature?: boolean
}

/** Materialise a signed package directory and return its path. */
function writePackage(root: string, packageId: string, opts: FixtureOpts = {}): string {
  const dir = join(root, packageId)
  const files = packageFiles(packageId)
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
      keyId: 'test-key',
      packageId,
      version: '1.0.0',
      signedAt: '2026-07-01T00:00:00.000Z',
      files: fileHashes,
    }
    const signature = cryptoSign(
      null,
      Uint8Array.from(Buffer.from(canonicalize(payload), 'utf-8')),
      PRIVATE_PEM,
    ).toString('base64')
    writeFileSync(join(dir, SIGNATURE_FILENAME), JSON.stringify({ ...payload, signature }, null, 2))
  }

  if (opts.tamperFile) {
    const full = join(dir, opts.tamperFile.rel)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, opts.tamperFile.content)
  }
  if (opts.injectFile) {
    const full = join(dir, opts.injectFile.rel)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, opts.injectFile.content)
  }

  return dir
}

/** In-memory `PackageManagerPort` pointing at one on-disk fixture. */
function stubPackageManager(packagePath: string, packageId = PACKAGE_ID): PackageManagerPort {
  const installed: InstalledPackage[] = [
    { packageId, version: '1.0.0', installedAt: '2026-07-01T00:00:00.000Z', path: packagePath, devices: [VPP_BOARD] },
  ]
  return {
    listInstalled: () => installed,
    getInstalledPackageManifest: (id) => (id === packageId ? manifestFor(packageId) : null),
  }
}

function makeResolver(packagePath: string): VerifiedBoardInfoResolver {
  return new VerifiedBoardInfoResolver({
    halsContent: HALS,
    packageManager: stubPackageManager(packagePath),
    resolveHalSourcePath: (rel) => join('/bundled/hal', rel),
    resolvePackageRelativePath: (pkgPath, rel) => join(pkgPath, rel),
  })
}

describe('VerifiedBoardInfoResolver', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'vpp-verified-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('resolves a VPP board whose package signature is intact', () => {
    const info = makeResolver(writePackage(root, PACKAGE_ID)).resolve(VPP_BOARD)

    expect(info.source).toBe('vpp')
    expect(info.vppPackageId).toBe(PACKAGE_ID)
    expect(info.licenseStoreSourceFiles).toHaveLength(1)
  })

  it('refuses a board whose package files were altered after signing', () => {
    // The audit's attack: swap the shipped HAL for one that defines the gated
    // I/O wrappers itself, so the closed license-core is no longer needed.
    const dir = writePackage(root, PACKAGE_ID, {
      tamperFile: {
        rel: 'hal/arduino/esp32.cpp',
        content: 'void updateInputBuffers(void) {}\nvoid updateOutputBuffers(void) {}\n',
      },
    })

    expect(() => makeResolver(dir).resolve(VPP_BOARD)).toThrow(VppPackageSignatureError)
    expect(makeResolver(dir).verifyBoardPackage(VPP_BOARD)).toMatch(/Tampered file detected/i)
  })

  it('refuses a board whose package gained an unsigned file', () => {
    const dir = writePackage(root, PACKAGE_ID, {
      injectFile: { rel: 'hal/arduino/license_io_override.cpp', content: 'void updateInputBuffers(void) {}\n' },
    })

    expect(makeResolver(dir).verifyBoardPackage(VPP_BOARD)).toBeTruthy()
    expect(() => makeResolver(dir).resolve(VPP_BOARD)).toThrow(VppPackageSignatureError)
  })

  it('refuses a board whose package carries no signature at all', () => {
    const dir = writePackage(root, PACKAGE_ID, { omitSignature: true })

    expect(makeResolver(dir).verifyBoardPackage(VPP_BOARD)).toMatch(/not signed/i)
  })

  it('names the board and the reason in the refusal message', () => {
    const dir = writePackage(root, PACKAGE_ID, { omitSignature: true })

    try {
      makeResolver(dir).resolve(VPP_BOARD)
      throw new Error('expected resolve to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(VppPackageSignatureError)
      const signatureError = err as VppPackageSignatureError
      expect(signatureError.boardName).toBe(VPP_BOARD)
      expect(signatureError.message).toContain(VPP_BOARD)
      expect(signatureError.message).toContain('Refusing to build')
      expect(signatureError.message).toContain(signatureError.reason)
    }
  })

  it('leaves hals.json builtin boards alone (no package to verify)', () => {
    // Path deliberately does not exist: a builtin must not be dragged through
    // package verification at all.
    const info = makeResolver(join(root, 'does-not-exist')).resolve(BUILTIN_BOARD)

    expect(info.source).toBe('hals')
    expect(info.isRuntimeV4).toBe(true)
  })

  it('verifies a given package once per resolver instance', () => {
    const dir = writePackage(root, PACKAGE_ID)
    const resolver = makeResolver(dir)

    expect(resolver.resolve(VPP_BOARD).source).toBe('vpp')

    // Destroy the signature the first pass validated. A second resolve on the
    // same instance still succeeds, which is only possible if the verdict was
    // memoised rather than recomputed — the caching this fix relies on to keep
    // per-build cost at a few sha256 passes.
    unlinkSync(join(dir, SIGNATURE_FILENAME))
    expect(resolver.resolve(VPP_BOARD).source).toBe('vpp')

    // A fresh resolver (i.e. the next build) sees the real state again.
    expect(makeResolver(dir).verifyBoardPackage(VPP_BOARD)).toMatch(/not signed/i)
  })
})

/**
 * End-to-end guard on the real compile entrypoint. This is the test that goes
 * red if the verifying resolver is ever unwired from the build path.
 */
describe('CompilerModule.compileProgram — VPP package signature gate', () => {
  // Electron injects `process.resourcesPath`; under plain Node it is undefined
  // and the CompilerModule constructor's binary-path joins throw on it.
  if (!process.resourcesPath) {
    Object.defineProperty(process, 'resourcesPath', { value: tmpdir(), configurable: true })
  }

  let userDataDir: string
  let packagesDir: string
  let messages: Array<{ logLevel?: string; message?: string }>
  let closed: boolean

  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument */
  const fakePort = () => ({
    start: () => undefined,
    postMessage: (payload: { logLevel?: string; message?: string }) => {
      messages.push(payload)
    },
    close: () => {
      closed = true
    },
  })

  const bridge = {
    makeRuntimeApiRequest: jest.fn(),
    makeRuntimeApiUpload: jest.fn(),
    loadEnabledArchives: jest.fn(() => ({ archives: [], missing: [] })),
  }

  /** registry.json entry pointing at the fixture on disk. */
  function writeRegistry(packagePath: string): void {
    mkdirSync(packagesDir, { recursive: true })
    writeFileSync(
      join(packagesDir, 'registry.json'),
      JSON.stringify({
        formatVersion: '1.0',
        packages: {
          [PACKAGE_ID]: {
            version: '1.0.0',
            installedAt: '2026-07-01T00:00:00.000Z',
            path: packagePath,
            devices: [VPP_BOARD],
          },
        },
      }),
    )
  }

  async function runCompile(boardTarget: string): Promise<void> {
    const compiler = new CompilerModule()
    // The toolchain probe is the first thing past the signature gate. Making it
    // fail keeps the run short and, crucially, makes the difference between
    // "refused for a bad signature" and "got as far as the toolchain" visible
    // in `messages` instead of shelling out to arduino-cli.
    ;(compiler as any).checkArduinoCliAvailability = () => Promise.reject(new Error('toolchain probe stubbed out'))
    ;(compiler as any).checkStrucppAvailability = () => ({ success: true, data: 'stub' })

    const args = [
      join(userDataDir, 'project', 'project.json'),
      boardTarget,
      null,
      true,
      { pous: [], servers: [], remoteDevices: [] },
      null,
      null,
      false,
      null,
      {},
    ]
    // compileProgram only calls start/postMessage/close on the port; the rest of
    // MessagePortMain's EventEmitter surface is never touched.
    await compiler.compileProgram(args as any, fakePort() as any, bridge as any)
  }
  /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument */

  const joined = (): string => messages.map((m) => m.message ?? '').join('\n')

  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'vpp-compile-'))
    packagesDir = join(userDataDir, 'packages')
    messages = []
    closed = false
    // Both CompilerModule and PackageManagerModule read userData through this.
    ;(app.getPath as jest.Mock).mockReturnValue(userDataDir)
  })

  afterEach(() => {
    jest.clearAllMocks()
    rmSync(userDataDir, { recursive: true, force: true })
  })

  it('aborts the build when the target board comes from a tampered package', async () => {
    const dir = writePackage(packagesDir, PACKAGE_ID, {
      tamperFile: {
        rel: 'hal/arduino/esp32.cpp',
        content: 'void updateInputBuffers(void) {}\nvoid updateOutputBuffers(void) {}\n',
      },
    })
    writeRegistry(dir)

    await runCompile(VPP_BOARD)

    expect(joined()).toContain('Refusing to build')
    expect(joined()).toContain(VPP_BOARD)
    expect(joined()).toMatch(/Tampered file detected/i)
    expect(messages.some((m) => m.logLevel === 'error')).toBe(true)
    expect(closed).toBe(true)
    // Never reached the toolchain — the build stopped at the signature gate.
    expect(joined()).not.toContain('Checking tools availability')
  })

  it('aborts the build when the target board comes from an unsigned package', async () => {
    writeRegistry(writePackage(packagesDir, PACKAGE_ID, { omitSignature: true }))

    await runCompile(VPP_BOARD)

    expect(joined()).toContain('Refusing to build')
    expect(joined()).not.toContain('Checking tools availability')
  })

  it('lets a validly signed package through to the rest of the pipeline', async () => {
    writeRegistry(writePackage(packagesDir, PACKAGE_ID))

    await runCompile(VPP_BOARD)

    expect(joined()).not.toContain('Refusing to build')
    // Progressed past the gate and stopped only at the stubbed toolchain probe.
    expect(joined()).toContain('Checking tools availability')
  })

  it('does not gate builds for builtin hals.json boards', async () => {
    writeRegistry(writePackage(packagesDir, PACKAGE_ID, { omitSignature: true }))

    await runCompile(BUILTIN_BOARD)

    expect(joined()).not.toContain('Refusing to build')
    expect(joined()).toContain('Checking tools availability')
  })
})
