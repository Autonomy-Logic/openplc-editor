/**
 * The generated trust module through its single entry point and through PackageManagerModule: its verdicts, the
 * shared verifier, the Ed25519 primitive and sha256 neutralized, the canaries, and the equivalence of each site's
 * inlined checks with the shared ones. With OPENPLC_TRUST_MODULE_UNDER_TEST set, the rows that need only the real
 * Autonomy key run against that file.
 * @jest-environment node
 */
import { cpSync, existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { app } from 'electron'

import { DEVELOPMENT_SEED } from '../../../../../scripts/package-trust/generator'
import { verifyFileSet, verifyManifestIdentity } from '../../../shared/utils/vpp/package-verification-core'
import { TRUSTED_PACKAGE_KEYS } from '../../../shared/utils/vpp/trusted-keys'
import { verifyPackageSignature } from '../../../shared/utils/vpp/verify-package-signature'
import type { DependencyInstallResult } from '../../package-manager/arduino-dependency-installer'
import { PackageManagerModule } from '../../package-manager/package-manager-module'
import type { TrustVerdict, VerifyTrustedPackage } from '../types'
import {
  CORPUS,
  type CorpusCase,
  CORPUS_PACKAGE_ID,
  CORPUS_VERSION,
  writeCorpusCase,
} from './fixtures/equivalence-corpus'
import {
  extractFx3u,
  FX3U_BOARD,
  FX3U_PACKAGE_ID,
  FX3U_VPP,
  installByHand,
  pemToDer,
  readRegistryPackages,
  type SignedTestPackage,
  signTestPackage,
  UNTRUSTED_BOARD,
  UNTRUSTED_KEY,
  UNTRUSTED_PACKAGE_ID,
  zipPackage,
} from './fixtures/sign-test-package'
import {
  accepted,
  acceptingCrypto,
  acceptingVerifier,
  allSiteFunctions,
  canaryPatches,
  constantHashCrypto,
  controlledPath,
  countingFs,
  generateTestModule,
  type GeneratedModule,
  isolatableSites,
  loadModule,
  neutralizeSites,
  realTrustModule,
  recordingCrypto,
  REFUSED,
  refused,
  sameBytes,
  SEED_A,
  SEED_B,
  type SiteControl,
  siteFunctions,
  TEST_AUTONOMY_KEY,
  TEST_KEYS,
  testSeeds,
  toHex,
  type VerifierModule,
  type VerifyCall,
  wideningVerifier,
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
jest.mock('../../../shared/utils/vpp/package-verification-core', () => {
  const actual = jest.requireActual<typeof import('../../../shared/utils/vpp/package-verification-core')>(
    '../../../shared/utils/vpp/package-verification-core',
  )
  return {
    ...actual,
    verifyFileSet: jest.fn(actual.verifyFileSet),
    verifyManifestIdentity: jest.fn(actual.verifyManifestIdentity),
  }
})

const actualVerifier = jest.requireActual<typeof import('../../../shared/utils/vpp/verify-package-signature')>(
  '../../../shared/utils/vpp/verify-package-signature',
)
const actualCore = jest.requireActual<typeof import('../../../shared/utils/vpp/package-verification-core')>(
  '../../../shared/utils/vpp/package-verification-core',
)

const IMPORT_REFUSED = `Package signature verification failed: ${REFUSED}`
const HOOKS = [true, false] as const
const hookName = (atImport: boolean): string => (atImport ? 'import' : 'use')
const atImportOf = (hook: 'import' | 'use'): boolean => hook === 'import'
const TIMEOUT = 300000

/** A sha256 digest no file of the fixtures has; the stubbed createHash returns it for every input. */
const CONSTANT_DIGEST = 'ab'.repeat(32)

const real = realTrustModule()
const describeWithTestKey = real.fromEnvironment ? describe.skip : describe

let work = ''
let packagesDir = ''

beforeEach(() => {
  work = mkdtempSync(join(realpathSync(tmpdir()), 'package-trust-sites-'))
  const userData = join(work, 'user-data')
  packagesDir = join(userData, 'packages')
  jest.mocked(app.getPath).mockReturnValue(userData)
  jest.mocked(verifyPackageSignature).mockReset().mockImplementation(actualVerifier.verifyPackageSignature)
  jest.mocked(verifyFileSet).mockReset().mockImplementation(actualCore.verifyFileSet)
  jest.mocked(verifyManifestIdentity).mockReset().mockImplementation(actualCore.verifyManifestIdentity)
})

afterEach(() => {
  rmSync(work, { recursive: true, force: true })
})

/** Makes the shared file-set and manifest-identity checks report every package as valid (P2). */
function neutralizeSharedChecks(): void {
  jest.mocked(verifyFileSet).mockReturnValue({ valid: true })
  jest.mocked(verifyManifestIdentity).mockReturnValue({ valid: true })
}

const noDependencies = (): Promise<DependencyInstallResult> => Promise.resolve({ ok: true, installed: 0 })

/** The verdicts of @p verify for @p dir at the import hook, then at the use hook. */
function verdicts(verify: VerifyTrustedPackage, dir: string): TrustVerdict[] {
  return HOOKS.map((atImport) => verify(dir, atImport))
}

/** A package manager on the real module; the default constructor unless the environment names a module. */
function realManager(): PackageManagerModule {
  return real.fromEnvironment ? new PackageManagerModule(real.verify) : new PackageManagerModule()
}

/**
 * The module @p source with @p functionNames neutralized and the shared verifier accepting everything, primed with
 * @p acceptedDir at both hooks so each neutralized site replays its accepting answer. Priming uses the real primitive.
 */
function primedNeutralized(
  source: string,
  functionNames: string[],
  acceptedDir: string,
  crypto: { crypto: object; setFaulty: (faulty: boolean) => void } = recordingCrypto(),
): VerifyTrustedPackage {
  const verify = loadModule(neutralizeSites(source, functionNames), {
    verifier: acceptingVerifier,
    crypto: crypto.crypto,
  })
  crypto.setFaulty(false)
  const primed = verdicts(verify, acceptedDir)
  crypto.setFaulty(true)
  if (primed.some((verdict) => verdict[0] !== true)) throw new Error('Priming refused the accepted package')
  return verify
}

/** A module whose sites run one at a time: every other site replays its answer to the priming package. */
interface IsolatedModule {
  verify: VerifyTrustedPackage
  /** Runs only @p site; null runs every site. */
  only(site: string | null): void
}

function isolatedModule(
  source: string,
  siteNames: string[],
  acceptedDir: string,
  verifier: VerifierModule,
  crypto: { crypto: object; setFaulty: (faulty: boolean) => void } = recordingCrypto(),
): IsolatedModule {
  const control: SiteControl = { name: null }
  const verify = loadModule(isolatableSites(source, siteNames), {
    verifier,
    crypto: crypto.crypto,
    path: controlledPath(control),
  })
  crypto.setFaulty(false)
  const primed = verdicts(verify, acceptedDir)
  crypto.setFaulty(true)
  if (primed.some((verdict) => verdict[0] !== true)) throw new Error('Priming refused the accepted package')
  return {
    verify,
    only: (site) => {
      control.name = site
    },
  }
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

/** A package the test key signs whose signed hashes are all CONSTANT_DIGEST: it passes only a stubbed sha256. */
const CONSTANT_HASH_CASE: CorpusCase = {
  name: 'a package whose signed hashes are the stubbed digest',
  spec: {
    signedFiles: (hashes) => Object.fromEntries(Object.keys(hashes).map((rel) => [rel, CONSTANT_DIGEST])),
  },
}

describeWithTestKey('modules generated for a test Autonomy key', () => {
  const SEEDS = [SEED_A, SEED_B, DEVELOPMENT_SEED, ...testSeeds(50)]
  const modules: GeneratedModule[] = []
  const packages = new Map<string, SignedTestPackage>()
  const corpus: { name: string; dir: string; valid: boolean; error: string }[] = []
  let fixtures = ''
  let valid = ''
  let constantHash = ''

  beforeAll(() => {
    fixtures = mkdtempSync(join(realpathSync(tmpdir()), 'package-trust-seeds-'))
    for (const seed of SEEDS) modules.push(generateTestModule(seed))
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
    constantHash = writeCorpusCase(join(fixtures, 'constant-hash'), CONSTANT_HASH_CASE)
    CORPUS.forEach((corpusCase, index) => {
      const dir = writeCorpusCase(join(fixtures, 'corpus', String(index)), corpusCase)
      const shared = actualVerifier.verifyPackageSignature(dir, TEST_KEYS)
      corpus.push({ name: corpusCase.name, dir, valid: shared.valid, error: shared.error ?? '' })
    })
  }, TIMEOUT)

  afterAll(() => {
    rmSync(fixtures, { recursive: true, force: true })
  })

  const dirOf = (name: string): string => packages.get(name)?.dir ?? ''

  const plainLoads = new WeakMap<GeneratedModule, VerifyTrustedPackage>()
  const acceptingLoads = new WeakMap<GeneratedModule, VerifyTrustedPackage>()

  /** @p module on its real imports, loaded once. */
  function plain(module: GeneratedModule): VerifyTrustedPackage {
    const loaded = plainLoads.get(module) ?? loadModule(module.source)
    plainLoads.set(module, loaded)
    return loaded
  }

  /** @p module with the shared verifier accepting every package, loaded once. */
  function withAcceptingVerifier(module: GeneratedModule): VerifyTrustedPackage {
    const loaded = acceptingLoads.get(module) ?? loadModule(module.source, { verifier: acceptingVerifier })
    acceptingLoads.set(module, loaded)
    return loaded
  }

  /** The hex seeds whose module fails @p passes. */
  function failingSeeds(passes: (module: GeneratedModule) => boolean): string[] {
    return modules.filter((module) => !passes(module)).map((module) => toHex(module.seed))
  }

  it(
    'accepts a package signed by the module key at both hooks with its signed identity (positive control)',
    () => {
      const failing = failingSeeds((module) => {
        const verify = plain(module)
        return (
          JSON.stringify(verdicts(verify, valid)) ===
          JSON.stringify([0, 1].map(() => accepted('com.test.valid', '1.0.0')))
        )
      })

      expect(failing).toEqual([])
    },
    TIMEOUT,
  )

  it(
    'ABUSE-03: refuses the untrusted-dev package at both hooks with the shared verifier reason, which leads',
    () => {
      const untrusted = dirOf('the untrusted-dev package')

      const failing = failingSeeds(
        (module) =>
          JSON.stringify(verdicts(plain(module), untrusted)) ===
          JSON.stringify([0, 1].map(() => refused('Untrusted signing key: untrusted-dev'))),
      )

      expect(failing).toEqual([])
    },
    TIMEOUT,
  )

  it.each([
    'the untrusted-dev package',
    'the untrusted-dev package with its key id set to the trusted key id',
    'a validly signed package with a file altered',
    'a validly signed package with an unsigned file added',
    'a validly signed package whose manifest names another package than the signature',
  ])(
    'ABUSE-05: refuses %s at both hooks once the shared verifier accepts every package, naming no site',
    (name) => {
      const dir = dirOf(name)

      const failing = failingSeeds(
        (module) =>
          JSON.stringify(verdicts(withAcceptingVerifier(module), dir)) === JSON.stringify([refused(), refused()]),
      )

      expect(failing).toEqual([])
    },
    TIMEOUT,
  )

  it(
    'hands the shared verifier, once per call, a fresh key map with no prototype holding only the module key',
    () => {
      const failing = failingSeeds((module) => {
        const recording = wideningVerifier()
        const verify = loadModule(module.source, { verifier: recording.verifier })
        verify(valid, true)
        verify(valid, false)
        const [first, second] = recording.maps
        return (
          recording.maps.length === 2 &&
          first !== second &&
          recording.maps.every(
            (map) =>
              Object.getPrototypeOf(map) === null &&
              JSON.stringify(Object.keys(map)) === JSON.stringify([TEST_AUTONOMY_KEY.keyId]) &&
              sameBytes(pemToDer(map[TEST_AUTONOMY_KEY.keyId]), TEST_AUTONOMY_KEY.publicKeyDer),
          )
        )
      })

      expect(failing).toEqual([])
    },
    TIMEOUT,
  )

  it(
    'ABUSE-04: refuses the untrusted-dev package when the shared verifier adds its key to the map it received, and the next call gets a fresh map',
    () => {
      const untrusted = dirOf('the untrusted-dev package')

      const failing = failingSeeds((module) => {
        const keysOnEntry: string[][] = []
        const mutating: VerifierModule = {
          verifyPackageSignature: (dir, keys) => {
            keysOnEntry.push(Object.keys(keys))
            let widened = keys
            try {
              keys[UNTRUSTED_KEY.keyId] = UNTRUSTED_KEY.publicKeyPem
            } catch {
              widened = { ...keys, [UNTRUSTED_KEY.keyId]: UNTRUSTED_KEY.publicKeyPem }
            }
            return actualVerifier.verifyPackageSignature(dir, widened)
          },
        }
        const verify = loadModule(module.source, { verifier: mutating })
        const answers = [verify(untrusted, true), verify(untrusted, false), verify(untrusted, true)]
        return (
          JSON.stringify(answers) === JSON.stringify([refused(), refused(), refused()]) &&
          JSON.stringify(keysOnEntry) === JSON.stringify([0, 1, 2].map(() => [TEST_AUTONOMY_KEY.keyId]))
        )
      })

      expect(failing).toEqual([])
    },
    TIMEOUT,
  )

  it.each(HOOKS)(
    'accepts the untrusted-dev package at the hook with atImport %s once the shared verifier and every site of the hook are neutralized (control)',
    (atImport) => {
      const untrusted = dirOf('the untrusted-dev package')
      const hook = atImport ? 'import' : 'use'

      const failing = failingSeeds((module) => {
        const verify = primedNeutralized(module.source, siteFunctions(module.layout, hook), valid)
        return JSON.stringify(verify(untrusted, atImport)) === JSON.stringify(accepted(UNTRUSTED_PACKAGE_ID, '1.0.0'))
      })

      expect(failing).toEqual([])
    },
    TIMEOUT,
  )

  it.each([
    ['first', 'import'],
    ['last', 'import'],
    ['first', 'use'],
    ['last', 'use'],
  ] as const)(
    'ABUSE-05: refuses the untrusted-dev package with the shared verifier and the %s site of the %s hook neutralized',
    (position, hook) => {
      const untrusted = dirOf('the untrusted-dev package')

      const failing = failingSeeds((module) => {
        const functions = siteFunctions(module.layout, hook)
        const target = position === 'first' ? functions[0] : functions[functions.length - 1]
        const verify = primedNeutralized(module.source, [target], valid)
        return JSON.stringify(verify(untrusted, atImportOf(hook))) === JSON.stringify(refused())
      })

      expect(failing).toEqual([])
    },
    TIMEOUT,
  )

  it(
    'ABUSE-05: refuses every package at both hooks when the shared verifier and the Ed25519 primitive accept everything',
    () => {
      const untrusted = dirOf('the untrusted-dev package')

      const failing = failingSeeds((module) => {
        const verify = loadModule(module.source, { verifier: acceptingVerifier, crypto: acceptingCrypto() })
        return [untrusted, valid].every(
          (dir) => JSON.stringify(verdicts(verify, dir)) === JSON.stringify([refused(), refused()]),
        )
      })

      expect(failing).toEqual([])
    },
    TIMEOUT,
  )

  it(
    'ABUSE-05: refuses, at both hooks, a package whose signed hashes are the digest a stubbed createHash returns',
    () => {
      const untrusted = dirOf('the untrusted-dev package')
      const altered = dirOf('a validly signed package with a file altered')

      const failing = failingSeeds((module) => {
        const verify = loadModule(module.source, {
          verifier: acceptingVerifier,
          crypto: constantHashCrypto(CONSTANT_DIGEST),
        })
        return [constantHash, untrusted, altered].every(
          (dir) => JSON.stringify(verdicts(verify, dir)) === JSON.stringify([refused(), refused()]),
        )
      })

      expect(failing).toEqual([])
    },
    TIMEOUT,
  )

  it.each([
    'a validly signed package with a file altered',
    'a validly signed package with an unsigned file added',
    'a validly signed package whose manifest names another package than the signature',
  ])(
    'P2: refuses %s at both hooks when the shared verifyFileSet and verifyManifestIdentity report it valid',
    (name) => {
      const dir = dirOf(name)
      neutralizeSharedChecks()

      const failing = failingSeeds(
        (module) => JSON.stringify(verdicts(plain(module), dir)) === JSON.stringify([refused(), refused()]),
      )

      expect(actualVerifier.verifyPackageSignature(dir, TEST_KEYS)).toEqual({ valid: true })
      expect(failing).toEqual([])
    },
    TIMEOUT,
  )

  it.each(CANARY_FAULTS)(
    'M12: refuses a validly signed package at both hooks when the primitive %s',
    (_label, fault) => {
      const failing = failingSeeds((module) => {
        const verify = loadModule(module.source, {
          crypto: recordingCrypto(fault(TEST_AUTONOMY_KEY.publicKeyDer)).crypto,
        })
        return JSON.stringify(verdicts(verify, valid)) === JSON.stringify([refused(), refused()])
      })

      expect(failing).toEqual([])
    },
    TIMEOUT,
  )

  it.each(CANARY_FAULTS)(
    'M12: refuses at every single site of each hook when the primitive %s',
    (_label, fault) => {
      const failing: string[] = []
      for (const module of modules.slice(0, 3)) {
        const crypto = recordingCrypto(fault(TEST_AUTONOMY_KEY.publicKeyDer))
        const isolated = isolatedModule(
          module.source,
          allSiteFunctions(module.layout),
          valid,
          acceptingVerifier,
          crypto,
        )
        for (const site of module.layout.sites) {
          isolated.only(site.functionName)
          const verdict = isolated.verify(valid, atImportOf(site.hook))
          if (JSON.stringify(verdict) !== JSON.stringify(refused())) {
            failing.push(`${toHex(module.seed)} ${site.hook} ${site.functionName}`)
          }
        }
      }

      expect(failing).toEqual([])
    },
    TIMEOUT,
  )

  it(
    'ABUSE-05, M12: refuses a package signed by the module key at a site whose check canary is patched in the source',
    () => {
      const failing: string[] = []
      for (const module of modules.slice(0, 10)) {
        for (const site of module.layout.sites) {
          for (const [patch, source] of canaryPatches(module.source, site)) {
            const verdict = loadModule(source)(valid, atImportOf(site.hook))
            if (JSON.stringify(verdict) !== JSON.stringify(refused())) {
              failing.push(`${toHex(module.seed)} ${site.hook} ${site.functionName}: ${patch}`)
            }
          }
        }
      }

      expect(failing).toEqual([])
    },
    TIMEOUT,
  )

  it(
    'reads each file of the package once per call',
    () => {
      const failing = failingSeeds((module) => {
        const counting = countingFs()
        const verify = loadModule(module.source, { fs: counting.fs })
        return HOOKS.every((atImport) => {
          counting.reads.clear()
          const verdict = verify(valid, atImport)
          return (
            verdict[0] === true &&
            counting.reads.size >= 3 &&
            [...counting.reads.values()].every((count) => count === 1)
          )
        })
      })

      expect(failing).toEqual([])
    },
    TIMEOUT,
  )

  describe('equivalence of the inlined checks with the shared verifier', () => {
    it(
      'gives, at both hooks, the shared verifier verdict on every corpus package once the shared verifier accepts everything',
      () => {
        const failing: string[] = []
        for (const module of modules) {
          const verify = withAcceptingVerifier(module)
          for (const entry of corpus) {
            for (const atImport of HOOKS) {
              if (verify(entry.dir, atImport)[0] !== entry.valid) {
                failing.push(`${toHex(module.seed)} ${hookName(atImport)}: ${entry.name}`)
              }
            }
          }
        }

        expect(corpus.filter((entry) => entry.valid).length).toBeGreaterThanOrEqual(5)
        expect(failing).toEqual([])
      },
      TIMEOUT,
    )

    it(
      'returns the shared verifier reason, or the signed identity, on every corpus package with the real verifier',
      () => {
        const failing: string[] = []
        for (const module of modules) {
          const verify = plain(module)
          for (const entry of corpus) {
            const expected = entry.valid ? accepted(CORPUS_PACKAGE_ID, CORPUS_VERSION) : refused(entry.error)
            for (const atImport of HOOKS) {
              if (JSON.stringify(verify(entry.dir, atImport)) !== JSON.stringify(expected)) {
                failing.push(`${toHex(module.seed)} ${hookName(atImport)}: ${entry.name}`)
              }
            }
          }
        }

        expect(failing).toEqual([])
      },
      TIMEOUT,
    )

    it(
      'gives the shared verifier verdict on every corpus package at each single site, every other site replaying an accept',
      () => {
        const failing: string[] = []
        const primer = corpus[0]
        for (const module of modules) {
          const isolated = isolatedModule(module.source, allSiteFunctions(module.layout), primer.dir, acceptingVerifier)
          for (const site of module.layout.sites) {
            isolated.only(site.functionName)
            for (const entry of corpus) {
              if (isolated.verify(entry.dir, atImportOf(site.hook))[0] !== entry.valid) {
                failing.push(`${toHex(module.seed)} ${site.hook} ${site.functionName}: ${entry.name}`)
              }
            }
          }
        }

        expect(primer.valid).toBe(true)
        expect(failing).toEqual([])
      },
      TIMEOUT,
    )
  })
})

describe('the module with the Autonomy key', () => {
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
  }, TIMEOUT)

  afterAll(() => {
    rmSync(fixtures, { recursive: true, force: true })
  })

  const FX3U_ACCEPTED = accepted(FX3U_PACKAGE_ID, '2.1.0')

  async function vppOf(dir: string, name: string): Promise<string> {
    return zipPackage(dir, join(work, 'archives', `${name}.vpp`))
  }

  describe('positive control (AC5): the Autonomy-signed fx3u package', () => {
    it.each(HOOKS)('is accepted with its signed identity at the hook with atImport %s', (atImport) => {
      expect(real.verify(fx3u, atImport)).toEqual(FX3U_ACCEPTED)
    })

    it('is imported under its id', async () => {
      const manager = realManager()

      const result = await manager.importFromFile(FX3U_VPP, noDependencies)

      expect(result).toMatchObject({ success: true, packageId: FX3U_PACKAGE_ID })
      expect(readRegistryPackages(packagesDir)[FX3U_PACKAGE_ID]).toMatchObject({ version: '2.1.0' })
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
    it.each(HOOKS)('is refused with the shared verifier reason at the hook with atImport %s', (atImport) => {
      expect(real.verify(untrusted.dir, atImport)).toEqual(refused('Untrusted signing key: untrusted-dev'))
    })

    it('is refused at import, with the shared verifier reason, and nothing is installed', async () => {
      const manager = realManager()

      const result = await manager.importFromFile(await vppOf(untrusted.dir, 'untrusted'), noDependencies)

      expect(result).toEqual({
        success: false,
        error: 'Package signature verification failed: Untrusted signing key: untrusted-dev',
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

  describe('ABUSE-04: a key added to the map the module hands to the shared verifier', () => {
    /** Calls of the primitive over @p signedBytes whose key is not the Autonomy key. */
    const otherKeyChecks = (calls: VerifyCall[], signedBytes: Uint8Array): VerifyCall[] =>
      calls.filter((call) => sameBytes(call.message, signedBytes) && !sameBytes(call.key, real.keyDer))

    it('refuses the untrusted-dev package at import, verifying with no key but the Autonomy key', async () => {
      const recording = recordingCrypto()
      const widening = wideningVerifier({ [UNTRUSTED_KEY.keyId]: UNTRUSTED_KEY.publicKeyPem })
      const manager = new PackageManagerModule(real.load({ verifier: widening.verifier, crypto: recording.crypto }))

      const result = await manager.importFromFile(await vppOf(untrusted.dir, 'untrusted'), noDependencies)

      expect(result).toEqual({ success: false, error: IMPORT_REFUSED })
      expect(manager.listInstalled()).toEqual([])
      expect(widening.maps.length).toBeGreaterThan(0)
      expect(recording.calls.filter((call) => sameBytes(call.key, UNTRUSTED_KEY.publicKeyDer))).toEqual([])
      expect(otherKeyChecks(recording.calls, untrusted.signedBytes)).toEqual([])
    })

    it('refuses the package signed under the Autonomy key id when the map points that id at the untrusted-dev key', async () => {
      const recording = recordingCrypto()
      const widening = wideningVerifier({ [real.keyId]: UNTRUSTED_KEY.publicKeyPem })
      const manager = new PackageManagerModule(real.load({ verifier: widening.verifier, crypto: recording.crypto }))

      const result = await manager.importFromFile(
        await vppOf(untrustedAsAutonomy.dir, 'untrusted-as-autonomy'),
        noDependencies,
      )

      expect(result).toEqual({ success: false, error: IMPORT_REFUSED })
      expect(manager.listInstalled()).toEqual([])
      const packageChecks = recording.calls.filter((call) => sameBytes(call.message, untrustedAsAutonomy.signedBytes))
      expect(packageChecks.length).toBeGreaterThan(0)
      expect(otherKeyChecks(recording.calls, untrustedAsAutonomy.signedBytes)).toEqual([])
    })

    it('refuses the untrusted-dev package added by hand at the use hook: rejection reason, sweep and pre-build gate', () => {
      const folder = installByHand(packagesDir, UNTRUSTED_PACKAGE_ID, untrusted.dir, ['board'])
      const widening = wideningVerifier({ [UNTRUSTED_KEY.keyId]: UNTRUSTED_KEY.publicKeyPem })
      const manager = new PackageManagerModule(real.load({ verifier: widening.verifier }))

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
    const PACKAGES: [string, () => string, string][] = [
      ['the untrusted-dev package', () => untrusted.dir, UNTRUSTED_PACKAGE_ID],
      [
        'the untrusted-dev package with its key id set to the Autonomy key id',
        () => untrustedAsAutonomy.dir,
        UNTRUSTED_PACKAGE_ID,
      ],
      ['the fx3u package with a file altered beside its signature.json', () => alteredFx3u, FX3U_PACKAGE_ID],
      ['the fx3u package with an unsigned file added beside its signature.json', () => injectedFx3u, FX3U_PACKAGE_ID],
    ]

    beforeEach(() => {
      jest.mocked(verifyPackageSignature).mockReturnValue({ valid: true })
    })

    it.each(PACKAGES)('refuses %s at import and leaves the installed list unchanged', async (name, dir) => {
      const manager = realManager()

      const result = await manager.importFromFile(await vppOf(dir(), name.replace(/\W+/g, '-')), noDependencies)

      expect(result).toEqual({ success: false, error: IMPORT_REFUSED })
      expect(manager.listInstalled()).toEqual([])
    })

    it.each(PACKAGES)('refuses %s at both hooks, naming no site', (_name, dir) => {
      expect(verdicts(real.verify, dir())).toEqual([refused(), refused()])
    })

    it.each(PACKAGES)('refuses %s added by hand under its own id: the startup sweep removes it', (_name, dir, id) => {
      installByHand(packagesDir, id, dir(), ['board'])

      expect(realManager().installedPackageRejectionReason(id)).toBe(REFUSED)
      expect(realManager().verifyInstalledSignatures(jest.fn())).toEqual([id])
    })
  })

  describe('P2: the shared verifyFileSet and verifyManifestIdentity report every package valid', () => {
    const PACKAGES: [string, () => string][] = [
      ['the fx3u package with a file altered beside its signature.json', () => alteredFx3u],
      ['the fx3u package with an unsigned file added beside its signature.json', () => injectedFx3u],
    ]

    beforeEach(() => {
      neutralizeSharedChecks()
    })

    it.each(PACKAGES)('lets the shared verifier accept %s (control)', (_name, dir) => {
      expect(actualVerifier.verifyPackageSignature(dir(), TRUSTED_PACKAGE_KEYS)).toEqual({ valid: true })
    })

    it.each(PACKAGES)('still refuses %s at import, through the default constructor', async (name, dir) => {
      const manager = realManager()

      const result = await manager.importFromFile(await vppOf(dir(), name.replace(/\W+/g, '-')), noDependencies)

      expect(result).toEqual({ success: false, error: IMPORT_REFUSED })
      expect(manager.listInstalled()).toEqual([])
    })

    it.each(PACKAGES)('still refuses %s at both hooks', (_name, dir) => {
      expect(verdicts(real.verify, dir())).toEqual([refused(), refused()])
    })
  })

  describe('ABUSE-05: one site, the primitive or sha256 neutralized, with the shared verifier neutralized too', () => {
    it.each(HOOKS)(
      'accepts the untrusted-dev package at the hook with atImport %s once every site of the hook is neutralized (control)',
      (atImport) => {
        const verify = primedNeutralized(real.source, siteFunctions(real.layout, atImport ? 'import' : 'use'), fx3u)

        expect(verify(untrusted.dir, atImport)).toEqual(accepted(UNTRUSTED_PACKAGE_ID, '1.0.0'))
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
      const verify = primedNeutralized(real.source, [target], fx3u)

      expect(verify(untrusted.dir, atImportOf(hook))).toEqual(refused())
    })

    it('refuses the untrusted-dev package and the fx3u package when the primitive accepts every signature', () => {
      const verify = real.load({ verifier: acceptingVerifier, crypto: acceptingCrypto() })

      expect([untrusted.dir, fx3u].flatMap((dir) => verdicts(verify, dir))).toEqual([
        refused(),
        refused(),
        refused(),
        refused(),
      ])
    })

    it('refuses the untrusted-dev package and the altered fx3u package when createHash returns a constant digest', () => {
      const verify = real.load({ verifier: acceptingVerifier, crypto: constantHashCrypto(CONSTANT_DIGEST) })

      expect([untrusted.dir, alteredFx3u, fx3u].flatMap((dir) => verdicts(verify, dir))).toEqual(
        Array.from({ length: 6 }, () => refused()),
      )
    })
  })

  describe('ABUSE-05, M12: a check canary patched in the source', () => {
    it(
      'makes the patched site refuse the fx3u package, for every site and both patches',
      () => {
        const failing: string[] = []
        for (const site of real.layout.sites) {
          for (const [patch, source] of canaryPatches(real.source, site)) {
            const verdict = loadModule(source)(fx3u, atImportOf(site.hook))
            if (JSON.stringify(verdict) !== JSON.stringify(refused())) {
              failing.push(`${site.hook} ${site.functionName}: ${patch}`)
            }
          }
        }

        expect(failing).toEqual([])
      },
      TIMEOUT,
    )
  })

  describe('M12: a primitive that gets the canary wrong', () => {
    it.each(CANARY_FAULTS)(
      'makes every single site of each hook refuse the fx3u package when it %s',
      (_label, fault) => {
        const isolated = isolatedModule(
          real.source,
          allSiteFunctions(real.layout),
          fx3u,
          actualVerifier,
          recordingCrypto(fault(real.keyDer)),
        )
        const failing: string[] = []
        for (const site of real.layout.sites) {
          isolated.only(site.functionName)
          if (JSON.stringify(isolated.verify(fx3u, atImportOf(site.hook))) !== JSON.stringify(refused())) {
            failing.push(`${site.hook} ${site.functionName}`)
          }
        }

        expect(failing).toEqual([])
      },
    )
  })
})
