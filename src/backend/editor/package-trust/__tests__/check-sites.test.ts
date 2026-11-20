/**
 * The check sites of the generated trust module, through the anchor hooks and through PackageManagerModule.
 * With OPENPLC_TRUST_MODULE_UNDER_TEST set, the rows that need only the real Autonomy key run against that file.
 * @jest-environment node
 */
import { cpSync, existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { app } from 'electron'

import { loadTrustModule } from '../../../../../scripts/package-trust/load-module'
import { verifyPackageSignature } from '../../../shared/utils/vpp/verify-package-signature'
import type { DependencyInstallResult } from '../../package-manager/arduino-dependency-installer'
import { PackageManagerModule } from '../../package-manager/package-manager-module'
import { desktopPackageTrustAnchor, desktopPackageTrustMechanisms } from '../index'
import type { PackageTrustAnchor, PackageTrustMechanisms } from '../types'
import {
  UNTRUSTED_BOARD,
  UNTRUSTED_KEY,
  UNTRUSTED_PACKAGE_ID,
  extractFx3u,
  FX3U_BOARD,
  FX3U_PACKAGE_ID,
  FX3U_VPP,
  installByHand,
  readRegistryPackages,
  type SignedTestPackage,
  signTestPackage,
  zipPackage,
} from './fixtures/sign-test-package'
import {
  generateTestModule,
  type GeneratedModule,
  neutralizeSites,
  realTrustModule,
  recordingMechanisms,
  sameBytes,
  SEED_A,
  SEED_B,
  siteFunctions,
  TEST_AUTONOMY_KEY,
  testSeeds,
  toHex,
  withPrimitive,
} from './fixtures/trust-test-kit'

jest.mock('electron', () => ({ app: { getPath: jest.fn(() => '/mock/path') } }))
jest.mock('../../services/logger-service', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}))
jest.mock('../../../shared/utils/vpp/verify-package-signature', () => {
  const actual = jest.requireActual<typeof import('../../../shared/utils/vpp/verify-package-signature')>(
    '../../../shared/utils/vpp/verify-package-signature',
  )
  return { ...actual, verifyPackageSignature: jest.fn(actual.verifyPackageSignature) }
})

const actualVerifyPackageSignature = jest.requireActual<
  typeof import('../../../shared/utils/vpp/verify-package-signature')
>('../../../shared/utils/vpp/verify-package-signature').verifyPackageSignature

const REFUSED = 'Package trust check failed'
const IMPORT_REFUSED = `Package signature verification failed: ${REFUSED}`
const HOOKS = ['import', 'use'] as const
type Hook = (typeof HOOKS)[number]

const real = realTrustModule()
const describeWithTestKey = real.fromEnvironment ? describe.skip : describe

let work = ''
let packagesDir = ''

beforeEach(() => {
  work = mkdtempSync(join(realpathSync(tmpdir()), 'package-trust-sites-'))
  const userData = join(work, 'user-data')
  packagesDir = join(userData, 'packages')
  jest.mocked(app.getPath).mockReturnValue(userData)
  jest.mocked(verifyPackageSignature).mockImplementation(actualVerifyPackageSignature)
})

afterEach(() => {
  jest.clearAllMocks()
  rmSync(work, { recursive: true, force: true })
})

const noDependencies = (): Promise<DependencyInstallResult> => Promise.resolve({ ok: true, installed: 0 })

function check(anchor: PackageTrustAnchor, hook: Hook, dir: string): string | null {
  return hook === 'import' ? anchor.checkAtImport(dir) : anchor.checkAtUse(dir)
}

/** The anchor of the real module, as the editor wires it (the committed module unless the environment names one). */
function realAnchor(mechanisms: PackageTrustMechanisms = desktopPackageTrustMechanisms): PackageTrustAnchor {
  return real.fromEnvironment || mechanisms !== desktopPackageTrustMechanisms
    ? real.create(mechanisms)
    : desktopPackageTrustAnchor
}

/** A package manager on the real module; the default constructor unless the environment names a module. */
function realManager(): PackageManagerModule {
  return real.fromEnvironment
    ? new PackageManagerModule(real.create(desktopPackageTrustMechanisms))
    : new PackageManagerModule()
}

/**
 * The anchor of @p source with @p functionNames neutralized, primed with @p acceptedDir so each neutralized site
 * replays its accepting answer. Priming runs with the real primitive.
 */
function primedAnchor(
  source: string,
  functionNames: string[],
  acceptedDir: string,
  mechanisms: { mechanisms: PackageTrustMechanisms; setFaulty: (faulty: boolean) => void },
): PackageTrustAnchor {
  const anchor = loadTrustModule(neutralizeSites(source, functionNames))(mechanisms.mechanisms)
  mechanisms.setFaulty(false)
  expect([anchor.checkAtImport(acceptedDir), anchor.checkAtUse(acceptedDir)]).toEqual([null, null])
  mechanisms.setFaulty(true)
  return anchor
}

/** A primitive that accepts anything under @p trustedDer, so the known-invalid canary passes. */
const acceptsInvalidUnderTrustedKey =
  (trustedDer: Uint8Array) =>
  (call: { key: Uint8Array }, realAnswer: boolean): boolean =>
    realAnswer || sameBytes(call.key, trustedDer)

/** A primitive that rejects anything not under @p trustedDer, so the known-valid canary fails. */
const rejectsUnderOtherKeys =
  (trustedDer: Uint8Array) =>
  (call: { key: Uint8Array }, realAnswer: boolean): boolean =>
    realAnswer && sameBytes(call.key, trustedDer)

const CANARY_FAULTS = [
  ['accepts the known-invalid canary', acceptsInvalidUnderTrustedKey],
  ['rejects the known-valid canary', rejectsUnderOtherKeys],
] as const

describeWithTestKey('check sites of modules generated for a test Autonomy key', () => {
  const modules: GeneratedModule[] = []
  const packages = new Map<string, SignedTestPackage>()
  let fixtures = ''
  let valid = ''

  beforeAll(() => {
    fixtures = mkdtempSync(join(realpathSync(tmpdir()), 'package-trust-seeds-'))
    for (const seed of [SEED_A, SEED_B, ...testSeeds(50)]) modules.push(generateTestModule(seed))
    const trusted = { key: TEST_AUTONOMY_KEY, packageId: 'com.test.valid', boardName: 'Test Board' }
    valid = signTestPackage(join(fixtures, 'valid'), trusted).dir
    packages.set('the untrusted-dev package', signTestPackage(join(fixtures, 'untrusted')))
    packages.set(
      'the untrusted-dev package with its key id set to the trusted key id',
      signTestPackage(join(fixtures, 'untrusted-rekeyed'), { keyId: TEST_AUTONOMY_KEY.keyId }),
    )
    packages.set(
      'a validly signed package with a file altered',
      signTestPackage(join(fixtures, 'altered'), {
        ...trusted,
        alter: { 'plugin/main.c': 'int vpp_init(void) { return 1; }' },
      }),
    )
    packages.set(
      'a validly signed package with an unsigned file added',
      signTestPackage(join(fixtures, 'injected'), { ...trusted, alter: { 'plugin/extra.c': 'void extra(void) {}' } }),
    )
    packages.set(
      'a validly signed package whose manifest names another package than the signature',
      signTestPackage(join(fixtures, 'relabeled'), { ...trusted, signedPackageId: 'com.test.other' }),
    )
  }, 120000)

  afterAll(() => {
    rmSync(fixtures, { recursive: true, force: true })
  })

  /** The hex seeds whose module fails @p passes. */
  function failingSeeds(passes: (module: GeneratedModule) => boolean): string[] {
    return modules.filter((module) => !passes(module)).map((module) => toHex(module.seed))
  }

  it('accepts a package signed by the module key at both hooks (positive control)', () => {
    const failing = failingSeeds((module) => {
      const anchor = loadTrustModule(module.source)(desktopPackageTrustMechanisms)
      return anchor.checkAtImport(valid) === null && anchor.checkAtUse(valid) === null
    })

    expect(failing).toEqual([])
  }, 120000)

  it.each([
    'the untrusted-dev package',
    'the untrusted-dev package with its key id set to the trusted key id',
    'a validly signed package with a file altered',
    'a validly signed package with an unsigned file added',
    'a validly signed package whose manifest names another package than the signature',
  ])(
    'refuses %s at both hooks, naming no site',
    (name) => {
      const dir = packages.get(name)?.dir ?? ''

      const failing = failingSeeds((module) => {
        const anchor = loadTrustModule(module.source)(desktopPackageTrustMechanisms)
        return anchor.checkAtImport(dir) === REFUSED && anchor.checkAtUse(dir) === REFUSED
      })

      expect(failing).toEqual([])
    },
    120000,
  )

  it.each(HOOKS)(
    'accepts the untrusted-dev package at the %s hook once every site of the hook is neutralized',
    (hook) => {
      const untrusted = packages.get('the untrusted-dev package')?.dir ?? ''

      const failing = failingSeeds((module) => {
        const anchor = primedAnchor(module.source, siteFunctions(module.layout, hook), valid, recordingMechanisms())
        return check(anchor, hook, untrusted) === null
      })

      expect(failing).toEqual([])
    },
    120000,
  )

  it.each([
    ['first', 'import'],
    ['last', 'import'],
    ['first', 'use'],
    ['last', 'use'],
  ] as const)(
    'refuses the untrusted-dev package with the %s site of the %s hook neutralized',
    (position, hook) => {
      const untrusted = packages.get('the untrusted-dev package')?.dir ?? ''

      const failing = failingSeeds((module) => {
        const functions = siteFunctions(module.layout, hook)
        const target = position === 'first' ? functions[0] : functions[functions.length - 1]
        const anchor = primedAnchor(module.source, [target], valid, recordingMechanisms())
        return check(anchor, hook, untrusted) === REFUSED
      })

      expect(failing).toEqual([])
    },
    120000,
  )

  it('refuses every package at both hooks when the Ed25519 primitive accepts every signature', () => {
    const untrusted = packages.get('the untrusted-dev package')?.dir ?? ''

    const failing = failingSeeds((module) => {
      const anchor = loadTrustModule(module.source)(withPrimitive(desktopPackageTrustMechanisms, () => true))
      return [untrusted, valid].every((dir) => HOOKS.every((hook) => check(anchor, hook, dir) === REFUSED))
    })

    expect(failing).toEqual([])
  }, 120000)

  it.each(CANARY_FAULTS)(
    'refuses a validly signed package at both hooks when the primitive %s',
    (_label, fault) => {
      const failing = failingSeeds((module) => {
        const anchor = loadTrustModule(module.source)(
          recordingMechanisms(fault(TEST_AUTONOMY_KEY.publicKeyDer)).mechanisms,
        )
        return HOOKS.every((hook) => check(anchor, hook, valid) === REFUSED)
      })

      expect(failing).toEqual([])
    },
    120000,
  )

  it.each(CANARY_FAULTS)(
    'refuses at every single site of each hook when the primitive %s',
    (_label, fault) => {
      const failing: string[] = []
      for (const module of modules.slice(0, 2)) {
        for (const hook of HOOKS) {
          const functions = siteFunctions(module.layout, hook)
          for (const kept of functions) {
            const others = functions.filter((name) => name !== kept)
            const recording = recordingMechanisms(fault(TEST_AUTONOMY_KEY.publicKeyDer))
            const anchor = primedAnchor(module.source, others, valid, recording)
            if (check(anchor, hook, valid) !== REFUSED) failing.push(`${toHex(module.seed)} ${hook} ${kept}`)
          }
        }
      }

      expect(failing).toEqual([])
    },
    120000,
  )
})

describe('check sites of the module with the Autonomy key', () => {
  let fixtures = ''
  let fx3u = ''
  let untrusted: SignedTestPackage
  let untrustedAsAutonomy: SignedTestPackage
  let alteredFx3u = ''
  let injectedFx3u = ''

  beforeAll(async () => {
    fixtures = mkdtempSync(join(realpathSync(tmpdir()), 'package-trust-real-'))
    fx3u = await extractFx3u(join(fixtures, 'fx3u'))
    untrusted = signTestPackage(join(fixtures, 'untrusted'))
    untrustedAsAutonomy = signTestPackage(join(fixtures, 'untrusted-as-autonomy'), { keyId: real.keyId })
    alteredFx3u = join(fixtures, 'fx3u-altered')
    cpSync(fx3u, alteredFx3u, { recursive: true })
    writeFileSync(join(alteredFx3u, 'hal', 'arduino', 'fx3u-14.cpp'), 'void hardwareInit() { /* altered */ }\n')
    injectedFx3u = join(fixtures, 'fx3u-injected')
    cpSync(fx3u, injectedFx3u, { recursive: true })
    writeFileSync(join(injectedFx3u, 'hal', 'arduino', 'extra.cpp'), 'void extra() {}\n')
  }, 120000)

  afterAll(() => {
    rmSync(fixtures, { recursive: true, force: true })
  })

  async function vppOf(dir: string, name: string): Promise<string> {
    return zipPackage(dir, join(work, 'archives', `${name}.vpp`))
  }

  describe('positive control (AC5): the Autonomy-signed fx3u package', () => {
    it.each(HOOKS)('is accepted by the anchor at the %s hook', (hook) => {
      expect(check(realAnchor(), hook, fx3u)).toBeNull()
    })

    it('is imported', async () => {
      const result = await realManager().importFromFile(FX3U_VPP, noDependencies)

      expect(result).toMatchObject({ success: true, packageId: FX3U_PACKAGE_ID })
    })

    it('is kept by the startup sweep', async () => {
      await realManager().importFromFile(FX3U_VPP, noDependencies)
      const warn = jest.fn()

      const removed = realManager().verifyInstalledSignatures(warn)

      expect({ removed, warnings: warn.mock.calls.length }).toEqual({ removed: [], warnings: 0 })
      expect(
        realManager()
          .listInstalled()
          .map((pkg) => pkg.packageId),
      ).toEqual([FX3U_PACKAGE_ID])
    })

    it('has no rejection reason', async () => {
      await realManager().importFromFile(FX3U_VPP, noDependencies)

      expect(realManager().installedPackageRejectionReason(FX3U_PACKAGE_ID)).toBeNull()
    })

    it('passes the pre-build gate for its board', async () => {
      await realManager().importFromFile(FX3U_VPP, noDependencies)

      expect(realManager().verifyBoardPackageIntegrity(FX3U_BOARD)).toEqual({ ok: true })
    })
  })

  describe('ABUSE-03: the untrusted-dev package on an unmodified editor', () => {
    it('is refused at import, with the shared verifier reason, and nothing is installed', async () => {
      const manager = realManager()

      const result = await manager.importFromFile(await vppOf(untrusted.dir, 'untrusted'), noDependencies)

      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining('Untrusted signing key: untrusted-dev'),
      })
      expect(manager.listInstalled()).toEqual([])
      expect(existsSync(join(packagesDir, UNTRUSTED_PACKAGE_ID))).toBe(false)
    })

    it('is removed by the startup sweep when added by hand, folder and registry entry included', () => {
      const folder = installByHand(packagesDir, UNTRUSTED_PACKAGE_ID, untrusted.dir, ['board'])
      const warn = jest.fn()

      const removed = realManager().verifyInstalledSignatures(warn)

      expect(removed).toEqual([UNTRUSTED_PACKAGE_ID])
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('was removed at startup'))
      expect(existsSync(folder)).toBe(false)
      expect(Object.keys(readRegistryPackages(packagesDir))).toEqual([])
    })

    it('has the shared verifier reason as its rejection reason', () => {
      installByHand(packagesDir, UNTRUSTED_PACKAGE_ID, untrusted.dir, ['board'])

      expect(realManager().installedPackageRejectionReason(UNTRUSTED_PACKAGE_ID)).toBe(
        'Untrusted signing key: untrusted-dev',
      )
    })

    it('stops a build for its board at the pre-build gate', () => {
      installByHand(packagesDir, UNTRUSTED_PACKAGE_ID, untrusted.dir, ['board'])

      expect(realManager().verifyBoardPackageIntegrity(UNTRUSTED_BOARD)).toEqual({
        ok: false,
        packageId: UNTRUSTED_PACKAGE_ID,
        reason: expect.stringContaining('untrusted-dev'),
      })
    })
  })

  describe('ABUSE-04: a key added to the map the anchor hands to the shared verifier', () => {
    /** The real anchor on @p mechanisms, whose `trustedKeys()` also maps @p keyId to the untrusted-dev key. */
    function widenedAnchor(keyId: string, mechanisms: PackageTrustMechanisms): PackageTrustAnchor {
      const inner = real.create(mechanisms)
      return {
        trustedKeys: () => ({ ...inner.trustedKeys(), [keyId]: UNTRUSTED_KEY.publicKeyPem }),
        checkAtImport: (dir) => inner.checkAtImport(dir),
        checkAtUse: (dir) => inner.checkAtUse(dir),
      }
    }

    it('refuses the untrusted-dev package at import, verifying with no key but the Autonomy key', async () => {
      const recording = recordingMechanisms()
      const manager = new PackageManagerModule(widenedAnchor('untrusted-dev', recording.mechanisms))

      const result = await manager.importFromFile(await vppOf(untrusted.dir, 'untrusted'), noDependencies)

      expect(result).toEqual({ success: false, error: IMPORT_REFUSED })
      expect(manager.listInstalled()).toEqual([])
      expect(recording.calls.filter((call) => sameBytes(call.key, UNTRUSTED_KEY.publicKeyDer))).toEqual([])
      expect(
        recording.calls.filter(
          (call) => sameBytes(call.message, untrusted.signedBytes) && !sameBytes(call.key, real.keyDer),
        ),
      ).toEqual([])
    })

    it('refuses the package signed under the Autonomy key id when the map points that id at the untrusted-dev key', async () => {
      const recording = recordingMechanisms()
      const manager = new PackageManagerModule(widenedAnchor(real.keyId, recording.mechanisms))

      const result = await manager.importFromFile(
        await vppOf(untrustedAsAutonomy.dir, 'untrusted-as-autonomy'),
        noDependencies,
      )

      expect(result).toEqual({ success: false, error: IMPORT_REFUSED })
      expect(manager.listInstalled()).toEqual([])
      const packageChecks = recording.calls.filter((call) => sameBytes(call.message, untrustedAsAutonomy.signedBytes))
      expect(packageChecks.length).toBeGreaterThan(0)
      expect(packageChecks.filter((call) => !sameBytes(call.key, real.keyDer))).toEqual([])
    })

    it('refuses the untrusted-dev package added by hand at the use hook: rejection reason, sweep and pre-build gate', () => {
      const folder = installByHand(packagesDir, UNTRUSTED_PACKAGE_ID, untrusted.dir, ['board'])
      const manager = new PackageManagerModule(widenedAnchor('untrusted-dev', desktopPackageTrustMechanisms))

      expect(manager.installedPackageRejectionReason(UNTRUSTED_PACKAGE_ID)).toBe(REFUSED)
      expect(manager.verifyBoardPackageIntegrity(UNTRUSTED_BOARD)).toEqual({
        ok: false,
        packageId: UNTRUSTED_PACKAGE_ID,
        reason: REFUSED,
      })
      expect(manager.verifyInstalledSignatures(jest.fn())).toEqual([UNTRUSTED_PACKAGE_ID])
      expect(existsSync(folder)).toBe(false)
    })
  })

  describe('ABUSE-05: the shared verifier neutralized (valid for any package)', () => {
    beforeEach(() => {
      jest.mocked(verifyPackageSignature).mockReturnValue({ valid: true })
    })

    it.each([
      ['the untrusted-dev package', () => untrusted.dir],
      ['the untrusted-dev package with its key id set to the Autonomy key id', () => untrustedAsAutonomy.dir],
      ['the fx3u package with a file altered beside its signature.json', () => alteredFx3u],
      ['the fx3u package with an unsigned file added beside its signature.json', () => injectedFx3u],
    ])('refuses %s at import and leaves the installed list unchanged', async (name, dir) => {
      const manager = realManager()

      const result = await manager.importFromFile(await vppOf(dir(), name.replace(/\W+/g, '-')), noDependencies)

      expect(result).toEqual({ success: false, error: IMPORT_REFUSED })
      expect(manager.listInstalled()).toEqual([])
    })

    it.each([
      ['the untrusted-dev package', () => untrusted.dir],
      ['the untrusted-dev package with its key id set to the Autonomy key id', () => untrustedAsAutonomy.dir],
      ['the fx3u package with a file altered beside its signature.json', () => alteredFx3u],
      ['the fx3u package with an unsigned file added beside its signature.json', () => injectedFx3u],
    ])('refuses %s at the anchor hooks', (_name, dir) => {
      expect(HOOKS.map((hook) => check(realAnchor(), hook, dir()))).toEqual([REFUSED, REFUSED])
    })
  })

  describe('ABUSE-05: one site or the primitive neutralized', () => {
    it.each(HOOKS)(
      'accepts the untrusted-dev package at the %s hook once every site of the hook is neutralized',
      (hook) => {
        const anchor = primedAnchor(real.source, siteFunctions(real.layout, hook), fx3u, recordingMechanisms())

        expect(check(anchor, hook, untrusted.dir)).toBeNull()
      },
    )

    it.each([
      ['first', 'import'],
      ['last', 'import'],
      ['first', 'use'],
      ['last', 'use'],
    ] as const)('refuses the untrusted-dev package with the %s site of the %s hook neutralized', (position, hook) => {
      const functions = siteFunctions(real.layout, hook)
      const target = position === 'first' ? functions[0] : functions[functions.length - 1]
      const anchor = primedAnchor(real.source, [target], fx3u, recordingMechanisms())

      expect(check(anchor, hook, untrusted.dir)).toBe(REFUSED)
    })

    it('refuses the untrusted-dev package and the fx3u package when the primitive accepts every signature', () => {
      const anchor = realAnchor(withPrimitive(desktopPackageTrustMechanisms, () => true))

      expect([untrusted.dir, fx3u].flatMap((dir) => HOOKS.map((hook) => check(anchor, hook, dir)))).toEqual([
        REFUSED,
        REFUSED,
        REFUSED,
        REFUSED,
      ])
    })
  })

  describe('M12: a primitive that gets the canary wrong', () => {
    it.each(CANARY_FAULTS)(
      'makes every single site of each hook refuse the fx3u package when it %s',
      (_label, fault) => {
        const failing: string[] = []
        for (const hook of HOOKS) {
          const functions = siteFunctions(real.layout, hook)
          for (const kept of functions) {
            const recording = recordingMechanisms(fault(real.keyDer))
            const anchor = primedAnchor(
              real.source,
              functions.filter((name) => name !== kept),
              fx3u,
              recording,
            )
            if (check(anchor, hook, fx3u) !== REFUSED) failing.push(`${hook} ${kept}`)
          }
        }

        expect(failing).toEqual([])
      },
    )
  })
})
