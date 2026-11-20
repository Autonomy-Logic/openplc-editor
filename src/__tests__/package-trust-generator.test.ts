/**
 * scripts/package-trust: the trust module generator, the release seed and the fingerprint check, run in process.
 * @jest-environment node
 */
import { createPublicKey } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { describe, expect, it } from '@jest/globals'

import { checkFingerprint } from '../../scripts/package-trust/fingerprint'
import {
  DEVELOPMENT_SEED,
  deriveReleaseSeed,
  generatePackageTrustModule,
  shareLiteralsFromSource,
} from '../../scripts/package-trust/generator'
import { loadTrustModule } from '../../scripts/package-trust/load-module'
import { desktopPackageTrustMechanisms } from '../backend/editor/package-trust'
import {
  COMMITTED_MODULE_PATH,
  developmentModule,
  flipCharacter,
  generateTestModule,
  type GeneratedModule,
  replaceLiteral,
  SEED_A,
  SEED_B,
  TEST_KEYS,
  testSeeds,
  toHex,
} from '../backend/editor/package-trust/__tests__/fixtures/trust-test-kit'
import { TRUSTED_PACKAGE_KEYS } from '../backend/shared/utils/vpp/trusted-keys'

const SECRET = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'
const VERSION = '4.3.5'
const COMMIT = 'b657afce48407566c1bcba9d94cb9fe359855428'
const RELEASE_SEED = '3ee6b0137153fce5144d02aacebac13284f0b980cc28efd0da8c6ceee4faaa6e'

const SEEDS = [SEED_A, SEED_B, ...testSeeds(50)]
const modules: GeneratedModule[] = SEEDS.map((seed) => generateTestModule(seed))

/** The hex seeds whose module fails @p passes. */
function failingSeeds(passes: (module: GeneratedModule) => boolean): string[] {
  return modules.filter((module) => !passes(module)).map((module) => toHex(module.seed))
}

/** Every 8-byte window of @p bytes, as lowercase hex. */
function hexWindows(bytes: Uint8Array): string[] {
  return Array.from({ length: bytes.length - 7 }, (_, start) => toHex(bytes.slice(start, start + 8)))
}

/** The text forms of a key and its id that must not appear in a generated module (M2). */
function keyForms(keyId: string, pem: string): string[] {
  const der = new Uint8Array(createPublicKey(pem).export({ format: 'der', type: 'spki' }))
  const raw = der.slice(der.length - 32)
  const body = pem.replace(/-----[^-]+-----/g, '').trim()
  const encode = (bytes: Uint8Array, encoding: BufferEncoding): string => Buffer.from(bytes).toString(encoding)
  return [
    keyId,
    encode(new TextEncoder().encode(keyId), 'hex'),
    encode(new TextEncoder().encode(keyId), 'base64').replace(/=+$/, ''),
    '-----BEGIN',
    'PUBLIC KEY',
    body,
    body.replace(/\s+/g, ''),
    JSON.stringify(pem).slice(1, -1),
    encode(der, 'base64').replace(/=+$/, ''),
    encode(raw, 'base64').replace(/=+$/, ''),
    encode(raw, 'base64url'),
    encode(raw, 'latin1'),
    encode(der, 'hex'),
    ...hexWindows(raw),
  ]
}

/** The forms of @p keys found in @p source; hex is matched without regard to case. */
function leakedKeyForms(source: string, keys: Record<string, string>): string[] {
  const lower = source.toLowerCase()
  return Object.entries(keys)
    .flatMap(([keyId, pem]) => keyForms(keyId, pem))
    .filter((form) => source.includes(form) || (/^[0-9a-f]+$/.test(form) && lower.includes(form)))
}

/** The anchor DER keys, which the share literals of the module recombine into. */
function trustedKeyDers(source: string): string[] | 'throws' {
  try {
    const keys = loadTrustModule(source)(desktopPackageTrustMechanisms).trustedKeys()
    return Object.values(keys)
      .map((pem) => toHex(new Uint8Array(createPublicKey(pem).export({ format: 'der', type: 'spki' }))))
      .sort()
  } catch {
    return 'throws'
  }
}

describe('generatePackageTrustModule', () => {
  it('gives byte-identical source and the same layout for the same options', () => {
    const options = { seed: SEED_A, keys: TEST_KEYS, typesImport: './types', header: { mode: 'development' } } as const

    expect(generatePackageTrustModule(options)).toEqual(generatePackageTrustModule(options))
  })

  it('puts the version and the commit in the first line of a release module only', () => {
    const release = generatePackageTrustModule({
      seed: SEED_A,
      keys: TEST_KEYS,
      typesImport: './types',
      header: { mode: 'release', version: VERSION, commit: COMMIT },
    }).source.split('\n')[0]
    const development = generateTestModule(SEED_A).source.split('\n')[0]

    expect([release.includes(VERSION), release.includes(COMMIT)]).toEqual([true, true])
    expect([development.includes(VERSION), development.includes(COMMIT)]).toEqual([false, false])
  })

  it('ABUSE-08: two seeds give different encoded key shares and different site functions', () => {
    const [a, b] = modules

    expect(a.layout.shareLiterals.filter((literal) => b.layout.shareLiterals.includes(literal))).toEqual([])
    expect(b.layout.sites).not.toEqual(a.layout.sites)
  })

  it('binds at least two sites to each hook, for every seed', () => {
    const failing = failingSeeds((module) =>
      ['import', 'use'].every((hook) => module.layout.sites.filter((site) => site.hook === hook).length >= 2),
    )

    expect(failing).toEqual([])
  })

  it('names in its layout share literals of letters and digits and functions that are in the source', () => {
    const failing = failingSeeds(
      ({ source, layout }) =>
        layout.shareLiterals.length > 0 &&
        layout.shareLiterals.every((literal) => /^[A-Za-z0-9]+$/.test(literal) && source.includes(literal)) &&
        layout.sites.every((site) => new RegExp(`\\b${site.functionName}\\b`).test(source)),
    )

    expect(failing).toEqual([])
  })

  it('hosts the sites in functions whose names do not tell what they do', () => {
    const failing = failingSeeds(({ layout }) =>
      layout.sites.every((site) => !/trust|canary|verif|signature|publickey|anchor|autonomy/i.test(site.functionName)),
    )

    expect(failing).toEqual([])
  })

  it('AC3: holds no form of the key or its id, for every seed', () => {
    const leaks = modules
      .map((module) => ({ seed: toHex(module.seed), leaked: leakedKeyForms(module.source, TEST_KEYS) }))
      .filter((entry) => entry.leaked.length > 0)

    expect(leaks).toEqual([])
  })

  it('AC3: the development module holds no form of the Autonomy key or its id', () => {
    expect(leakedKeyForms(developmentModule().source, TRUSTED_PACKAGE_KEYS)).toEqual([])
  })

  it('ABUSE-09: holds no form of the seed, for every seed', () => {
    const failing = failingSeeds(({ seed, source }) => {
      const lower = source.toLowerCase()
      const forms = [Buffer.from(seed).toString('base64').replace(/=+$/, ''), ...hexWindows(seed)]
      return forms.every((form) => !source.includes(form) && !lower.includes(form.toLowerCase()))
    })

    expect(failing).toEqual([])
  })
})

describe('shareLiteralsFromSource', () => {
  const sorted = (literals: string[]): string[] => [...literals].sort()

  /** True when the literals read from the source of @p module are the share literals of its layout. */
  const matchesLayout = ({ source, layout }: GeneratedModule): boolean =>
    JSON.stringify(sorted(shareLiteralsFromSource(source))) === JSON.stringify(sorted(layout.shareLiterals))

  /** The release module of @p seed, with the header and the types import generate-release gives it. */
  function releaseModule(seed: Uint8Array): GeneratedModule {
    const { source, layout } = generatePackageTrustModule({
      seed,
      keys: TEST_KEYS,
      typesImport: '../../src/backend/editor/package-trust/types',
      header: { mode: 'release', version: VERSION, commit: COMMIT },
    })
    return { seed, source, layout }
  }

  /** Two decoders, declared as the generator declares them. */
  const DECODERS = [
    'function ab1cde(parts: string[]): Uint8Array {',
    '  return new Uint8Array(parts.length)',
    '}',
    '',
    'function zz9yyy(parts: string[]): Uint8Array {',
    '  return new Uint8Array(parts.length)',
    '}',
    '',
  ]

  it('reads the share literals of the layout from the development module of every seed', () => {
    expect(failingSeeds(matchesLayout)).toEqual([])
  })

  it('reads the share literals of the layout from the release module of every seed', () => {
    const failing = SEEDS.map(releaseModule)
      .filter((module) => !matchesLayout(module))
      .map((module) => toHex(module.seed))

    expect(failing).toEqual([])
  })

  it('reads the share literals of the development module from the committed fallback', () => {
    const literals = shareLiteralsFromSource(readFileSync(COMMITTED_MODULE_PATH, 'utf-8'))

    expect(sorted(literals)).toEqual(sorted(developmentModule().layout.shareLiterals))
  })

  it('returns the literals of every decoder call in source order, a multi-line array included', () => {
    const source = [
      ...DECODERS,
      'function qq1aaa(): number {',
      "  const b0 = zz9yyy(['Pa1', 'Pb2'])",
      '  const d0 = ab1cde([',
      "    'Qa1',",
      "    'Qb2',",
      "    'Qc3',",
      '  ])',
      '  return b0.length + d0.length',
      '}',
      '',
    ].join('\n')

    expect(shareLiteralsFromSource(source)).toEqual(['Pa1', 'Pb2', 'Qa1', 'Qb2', 'Qc3'])
  })

  it('returns [] for a source with no decoder call, ignoring other string arrays and calls of other functions', () => {
    const source = [
      ...DECODERS,
      'function rr2bbb(parts: string[]): string {',
      "  return parts.join('')",
      '}',
      '',
      "export const k = ['Ka1', 'Kb2']",
      "export const r = rr2bbb(['Ra1', 'Rb2'])",
      '',
    ].join('\n')

    expect(shareLiteralsFromSource(source)).toEqual([])
  })

  it('reads a source whose evaluation would throw, so it never evaluates it', () => {
    const source = [
      "throw new Error('the source was evaluated')",
      '',
      ...DECODERS,
      "const b0 = ab1cde(['Ea1', 'Eb2'])",
      '',
    ].join('\n')

    expect(shareLiteralsFromSource(source)).toEqual(['Ea1', 'Eb2'])
  })
})

describe('seeds', () => {
  it('derives the release seed as HMAC-SHA256(secret, version+commit)', () => {
    expect(toHex(deriveReleaseSeed(SECRET, VERSION, COMMIT))).toBe(RELEASE_SEED)
  })

  it('has a 32-byte development seed', () => {
    expect(DEVELOPMENT_SEED.length).toBe(32)
  })
})

describe('checkFingerprint', () => {
  it('passes the module of every seed against the keys it was generated for', () => {
    const failing = failingSeeds(({ source }) => checkFingerprint(loadTrustModule(source), TEST_KEYS).ok)

    expect(failing).toEqual([])
  })

  it('passes the development module against the Autonomy key', () => {
    expect(checkFingerprint(loadTrustModule(developmentModule().source), TRUSTED_PACKAGE_KEYS)).toEqual({ ok: true })
  })

  it('fails a module that recombines another key, naming the fingerprint mismatch', () => {
    expect(checkFingerprint(loadTrustModule(modules[0].source), TRUSTED_PACKAGE_KEYS)).toEqual({
      ok: false,
      error: expect.stringContaining('fingerprint mismatch'),
    })
  })

  it('ABUSE-17: fails a module with one byte of one key share flipped, naming the fingerprint mismatch', () => {
    const flips: { literal: string; changesKey: boolean; result: ReturnType<typeof checkFingerprint> }[] = []
    for (const { source, layout } of modules.slice(0, 2)) {
      const original = trustedKeyDers(source)
      for (const literal of layout.shareLiterals) {
        const flipped = replaceLiteral(source, literal, flipCharacter(literal))
        const changesKey = JSON.stringify(trustedKeyDers(flipped)) !== JSON.stringify(original)
        flips.push({ literal, changesKey, result: checkFingerprint(loadTrustModule(flipped), TEST_KEYS) })
      }
    }
    const keyFlips = flips.filter((flip) => flip.changesKey)

    expect(keyFlips.length).toBeGreaterThan(0)
    expect(keyFlips.filter((flip) => flip.result.ok || !flip.result.error.includes('fingerprint mismatch'))).toEqual([])
  })
})
