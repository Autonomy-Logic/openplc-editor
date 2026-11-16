import { createHash, sign as cryptoSign } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { app } from 'electron'
import extract from 'extract-zip'

import { canonicalize, SIGNATURE_FILENAME } from '../../../shared/utils/vpp/verify-package-signature'

jest.mock('electron', () => ({ app: { getPath: jest.fn(() => '/mock/path') } }))
jest.mock('extract-zip', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('../../services/logger-service', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}))
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

import type { DependencyInstallResult } from '../arduino-dependency-installer'
import { PackageManagerModule } from '../package-manager-module'
import type { PackageManifest } from '../types'

const PACKAGE_ID = 'com.test.board'

const sha256 = (s: string): string =>
  createHash('sha256')
    .update(Uint8Array.from(Buffer.from(s, 'utf-8')))
    .digest('hex')

function manifestJson(version: string): string {
  return JSON.stringify({
    formatVersion: '1.0',
    package: { id: PACKAGE_ID, name: 'Test Board', version },
    devices: [{ id: 'dev', name: 'Test Board', target: { type: 'runtime-v4' }, hal: { pluginEntry: 'plugin/main.c' } }],
  })
}

/** The files of a signed package at @p version; @p tamper edits one after signing. */
function packageFiles(version: string, tamper = false): Record<string, string> {
  const files: Record<string, string> = {
    'manifest.json': manifestJson(version),
    'plugin/main.c': `int vpp_init(void) { return ${version.length}; }`,
  }
  const payload = {
    formatVersion: '1.0',
    alg: 'ed25519',
    keyId: 'test-key',
    packageId: PACKAGE_ID,
    version,
    signedAt: '2026-06-01T00:00:00.000Z',
    files: Object.fromEntries(Object.entries(files).map(([rel, content]) => [rel, sha256(content)])),
  }
  const signature = cryptoSign(null, Uint8Array.from(Buffer.from(canonicalize(payload), 'utf-8')), PRIVATE_PEM)
  files[SIGNATURE_FILENAME] = JSON.stringify({ ...payload, signature: signature.toString('base64') })
  if (tamper) files['plugin/main.c'] = 'int vpp_init(void) { return -1; }'
  return files
}

describe('PackageManagerModule.importFromFile with a dependency install', () => {
  let userDataDir: string
  let packagesDir: string
  const archives = new Map<string, Record<string, string>>()

  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'pkg-import-deps-'))
    packagesDir = join(userDataDir, 'packages')
    ;(app.getPath as jest.Mock).mockReturnValue(userDataDir)
    archives.clear()
    ;(extract as jest.Mock).mockImplementation((path: string, { dir }: { dir: string }) => {
      for (const [rel, content] of Object.entries(archives.get(path) ?? {})) {
        mkdirSync(dirname(join(dir, rel)), { recursive: true })
        writeFileSync(join(dir, rel), content)
      }
      return Promise.resolve()
    })
  })

  afterEach(() => {
    jest.clearAllMocks()
    rmSync(userDataDir, { recursive: true, force: true })
  })

  const tempFolders = () => readdirSync(packagesDir).filter((name) => name.startsWith('.import-'))
  const registryVersion = (manager: PackageManagerModule) =>
    manager.listInstalled().find((pkg) => pkg.packageId === PACKAGE_ID)?.version
  const installedMain = () => readFileSync(join(packagesDir, PACKAGE_ID, 'plugin', 'main.c'), 'utf-8')

  function callback(result: DependencyInstallResult) {
    return jest.fn((_manifest: PackageManifest) => Promise.resolve(result))
  }

  it('installs the dependencies of a verified package, then registers it', async () => {
    archives.set('v1.vpp', packageFiles('1.0.0'))
    const manager = new PackageManagerModule()
    const install = callback({ ok: true, installed: 2 })

    const result = await manager.importFromFile('v1.vpp', install)

    expect(result.success).toBe(true)
    expect(install).toHaveBeenCalledTimes(1)
    expect(install.mock.calls[0][0].package.id).toBe(PACKAGE_ID)
    expect(registryVersion(manager)).toBe('1.0.0')
    expect(tempFolders()).toEqual([])
  })

  it('never installs dependencies for a package that fails its signature check', async () => {
    archives.set('bad.vpp', packageFiles('1.0.0', true))
    const manager = new PackageManagerModule()
    const install = callback({ ok: true, installed: 0 })

    const result = await manager.importFromFile('bad.vpp', install)

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/signature verification failed/)
    expect(install).not.toHaveBeenCalled()
    expect(existsSync(join(packagesDir, PACKAGE_ID))).toBe(false)
    expect(tempFolders()).toEqual([])
  })

  it.each([
    ['fails', { ok: false, cancelled: false, error: 'Installing core x failed' } as const, false],
    ['is cancelled', { ok: false, cancelled: true, error: 'Installation cancelled.' } as const, true],
  ])('leaves nothing installed when the dependency install %s', async (_label, outcome, canceled) => {
    archives.set('v1.vpp', packageFiles('1.0.0'))
    const manager = new PackageManagerModule()

    const result = await manager.importFromFile('v1.vpp', callback(outcome))

    expect(result).toEqual({ success: false, canceled, error: outcome.error })
    expect(registryVersion(manager)).toBeUndefined()
    expect(existsSync(join(packagesDir, PACKAGE_ID))).toBe(false)
    expect(tempFolders()).toEqual([])
  })

  it('keeps the installed version when the next version fails to install its dependencies', async () => {
    archives.set('v1.vpp', packageFiles('1.0.0'))
    archives.set('v2.vpp', packageFiles('2.0.0'))
    const manager = new PackageManagerModule()
    await manager.importFromFile('v1.vpp', callback({ ok: true, installed: 0 }))
    const v1Main = installedMain()

    const result = await manager.importFromFile('v2.vpp', callback({ ok: false, cancelled: false, error: 'offline' }))

    expect(result.success).toBe(false)
    expect(registryVersion(manager)).toBe('1.0.0')
    expect(installedMain()).toBe(v1Main)
    expect(tempFolders()).toEqual([])
  })
})
