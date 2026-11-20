/**
 * O1: PackageManagerModule trusts a package only on the verified identity a passing check returns. Any other answer
 * of the injected VerifyTrustedPackage, a throw included, refuses the import and the installed package.
 * @jest-environment node
 */
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { app } from 'electron'

import {
  installByHand,
  readRegistryPackages,
  signTestPackage,
  UNTRUSTED_BOARD,
  UNTRUSTED_PACKAGE_ID,
  zipPackage,
} from '../../package-trust/__tests__/fixtures/sign-test-package'
import type { VerifyTrustedPackage } from '../../package-trust/types'
import { PackageManagerModule } from '../package-manager-module'

jest.mock('electron', () => ({ app: { getPath: jest.fn(() => '/mock/path') } }))
jest.mock('../../services/logger-service', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}))

const PREFIX = 'Package signature verification failed: '
const REFUSED = 'Package trust check failed'
const PACKAGE_ID = UNTRUSTED_PACKAGE_ID
const VERSION = '1.0.0'

/** A verify function answering @p value whatever its type, as a patched call site could. */
function answering(value: unknown): VerifyTrustedPackage {
  return jest.fn().mockReturnValue(value)
}

const throwing: VerifyTrustedPackage = () => {
  throw new Error('patched')
}

/** Answers that must never install a package or keep an installed one, with the reason each must give. */
const UNTRUSTED_ANSWERS: { label: string; verify: VerifyTrustedPackage; atImport: string; atUse: string }[] = [
  { label: 'null', verify: answering(null), atImport: REFUSED, atUse: REFUSED },
  { label: 'undefined', verify: answering(undefined), atImport: REFUSED, atUse: REFUSED },
  { label: '[]', verify: answering([]), atImport: REFUSED, atUse: REFUSED },
  { label: '[true]', verify: answering([true]), atImport: REFUSED, atUse: REFUSED },
  {
    label: "[true, 'other.id', '1.0.0']",
    verify: answering([true, 'other.id', VERSION]),
    atImport: REFUSED,
    atUse: REFUSED,
  },
  { label: '[true, 42, version]', verify: answering([true, 42, VERSION]), atImport: REFUSED, atUse: REFUSED },
  { label: "[false, 'x']", verify: answering([false, 'x']), atImport: 'x', atUse: 'x' },
  { label: '[false]', verify: answering([false]), atImport: REFUSED, atUse: REFUSED },
  { label: '[false, 42]', verify: answering([false, 42]), atImport: REFUSED, atUse: REFUSED },
  { label: 'a function that throws', verify: throwing, atImport: REFUSED, atUse: REFUSED },
]

/** Answers refused at import only: the identity is checked against the manifest there. */
const IMPORT_ONLY_ANSWERS: { label: string; verify: VerifyTrustedPackage }[] = [
  { label: '[true, id, another version]', verify: answering([true, PACKAGE_ID, '9.9.9']) },
  { label: '[true, id, 1] (a version that is not a string)', verify: answering([true, PACKAGE_ID, 1]) },
  { label: '[true, id] (no version)', verify: answering([true, PACKAGE_ID]) },
]

let fixtures = ''
let sourceDir = ''
let vpp = ''
let work = ''
let packagesDir = ''

beforeAll(async () => {
  fixtures = mkdtempSync(join(realpathSync(tmpdir()), 'trust-call-sites-fixtures-'))
  sourceDir = signTestPackage(join(fixtures, 'package')).dir
  vpp = await zipPackage(sourceDir, join(fixtures, 'package.vpp'))
})

afterAll(() => {
  rmSync(fixtures, { recursive: true, force: true })
})

beforeEach(() => {
  work = mkdtempSync(join(realpathSync(tmpdir()), 'trust-call-sites-'))
  packagesDir = join(work, 'packages')
  jest.mocked(app.getPath).mockReturnValue(work)
})

afterEach(() => {
  rmSync(work, { recursive: true, force: true })
})

/** What the packages directory holds after an import: the installed list, registry ids, target and temp folders. */
function installedState(manager: PackageManagerModule): {
  installed: string[]
  registry: string[]
  target: boolean
  temp: string[]
} {
  return {
    installed: manager.listInstalled().map((pkg) => pkg.packageId),
    registry: Object.keys(readRegistryPackages(packagesDir)),
    target: existsSync(join(packagesDir, PACKAGE_ID)),
    temp: existsSync(packagesDir) ? readdirSync(packagesDir).filter((name) => name.startsWith('.import-')) : [],
  }
}

const NOTHING_INSTALLED = { installed: [], registry: [], target: false, temp: [] }

describe('importFromFile', () => {
  it.each(UNTRUSTED_ANSWERS)(
    'fails when the check answers $label, installing nothing and removing the temp folder',
    async ({ verify, atImport }) => {
      const manager = new PackageManagerModule(verify)

      const result = await manager.importFromFile(vpp)

      expect(result).toEqual({ success: false, error: `${PREFIX}${atImport}` })
      expect(installedState(manager)).toEqual(NOTHING_INSTALLED)
    },
  )

  it.each(IMPORT_ONLY_ANSWERS)('fails when the check answers $label, installing nothing', async ({ verify }) => {
    const manager = new PackageManagerModule(verify)

    const result = await manager.importFromFile(vpp)

    expect(result).toEqual({ success: false, error: `${PREFIX}${REFUSED}` })
    expect(installedState(manager)).toEqual(NOTHING_INSTALLED)
  })

  it('fails with the prefix when the check answers an array-like object that is not an array', async () => {
    const manager = new PackageManagerModule(answering({ 0: true, 1: PACKAGE_ID, 2: VERSION, length: 3 }))

    const result = await manager.importFromFile(vpp)

    expect(result).toEqual({ success: false, error: expect.stringMatching(/^Package signature verification failed: /) })
    expect(installedState(manager)).toEqual(NOTHING_INSTALLED)
  })

  it('installs under the verified identity when the check answers the manifest identity (positive control)', async () => {
    const manager = new PackageManagerModule(answering([true, PACKAGE_ID, VERSION]))

    const result = await manager.importFromFile(vpp)

    expect(result).toMatchObject({ success: true, packageId: PACKAGE_ID })
    expect(readRegistryPackages(packagesDir)).toEqual({
      [PACKAGE_ID]: expect.objectContaining({ version: VERSION, path: join(packagesDir, PACKAGE_ID) }),
    })
    expect(existsSync(join(packagesDir, PACKAGE_ID, 'manifest.json'))).toBe(true)
  })

  it('asks the check once, at import, about the extracted package', async () => {
    const calls: { atImport: boolean; inPackages: boolean; holdsManifest: boolean }[] = []
    const manager = new PackageManagerModule((dir, atImport) => {
      calls.push({
        atImport,
        inPackages: dir.startsWith(`${packagesDir}/`) || dir.startsWith(`${packagesDir}\\`),
        holdsManifest: existsSync(join(dir, 'manifest.json')),
      })
      return [true, PACKAGE_ID, VERSION]
    })

    await manager.importFromFile(vpp)

    expect(calls).toEqual([{ atImport: true, inPackages: true, holdsManifest: true }])
  })
})

describe('an installed package', () => {
  it.each(UNTRUSTED_ANSWERS)(
    'is refused when the check answers $label: pre-build gate and startup sweep',
    ({ verify, atUse }) => {
      const folder = installByHand(packagesDir, PACKAGE_ID, sourceDir, ['board'])
      const manager = new PackageManagerModule(verify)
      const warn = jest.fn()

      expect(manager.verifyBoardPackageIntegrity(UNTRUSTED_BOARD)).toEqual({
        ok: false,
        packageId: PACKAGE_ID,
        reason: atUse,
      })
      expect(manager.verifyInstalledSignatures(warn)).toEqual([PACKAGE_ID])
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('was removed at startup'))
      expect(existsSync(folder)).toBe(false)
      expect(Object.keys(readRegistryPackages(packagesDir))).toEqual([])
    },
  )

  it('is refused when the check answers an array-like object that is not an array', () => {
    installByHand(packagesDir, PACKAGE_ID, sourceDir, ['board'])
    const manager = new PackageManagerModule(answering({ 0: true, 1: PACKAGE_ID, 2: VERSION, length: 3 }))

    expect(manager.verifyBoardPackageIntegrity(UNTRUSTED_BOARD)).toMatchObject({ ok: false })
    expect(manager.verifyInstalledSignatures(jest.fn())).toEqual([PACKAGE_ID])
  })

  it('is kept when the check answers its registry id (positive control)', () => {
    installByHand(packagesDir, PACKAGE_ID, sourceDir, ['board'])
    const manager = new PackageManagerModule(answering([true, PACKAGE_ID, VERSION]))

    expect(manager.verifyBoardPackageIntegrity(UNTRUSTED_BOARD)).toEqual({ ok: true })
    expect(manager.verifyInstalledSignatures(jest.fn())).toEqual([])
  })

  it('asks the check, at the pre-build gate, about the folder its registry entry records', () => {
    const folder = installByHand(packagesDir, PACKAGE_ID, sourceDir, ['board'])
    const calls: [string, boolean][] = []
    const manager = new PackageManagerModule((dir, atImport) => {
      calls.push([dir, atImport])
      return [true, PACKAGE_ID, VERSION]
    })

    manager.verifyBoardPackageIntegrity(UNTRUSTED_BOARD)

    expect(calls).toEqual([[folder, false]])
  })
})
