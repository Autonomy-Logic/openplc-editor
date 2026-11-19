import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import {
  DEVELOPMENT_SEED,
  generatePackageTrustModule,
  type TrustModuleLayout,
} from '../../../../../../scripts/package-trust/generator'
import { loadTrustModule } from '../../../../../../scripts/package-trust/load-module'
import { TRUSTED_PACKAGE_KEYS } from '../../../../shared/utils/vpp/trusted-keys'
import { desktopPackageTrustMechanisms } from '../../index'
import { createPackageTrustAnchor } from '../../package-trust-anchor'
import type { CreatePackageTrustAnchor, PackageTrustAnchor, PackageTrustMechanisms } from '../../types'
import { FX3U_KEY_ID, pemToDer, testSigningKey } from './sign-test-package'

/** The throwaway key that plays the Autonomy key in modules generated for tests. */
export const TEST_AUTONOMY_KEY = testSigningKey(
  'test-key',
  '4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb',
)
export const TEST_KEYS: Record<string, string> = { [TEST_AUTONOMY_KEY.keyId]: TEST_AUTONOMY_KEY.publicKeyPem }

const seedFromHex = (hex: string): Uint8Array => new Uint8Array(Buffer.from(hex, 'hex'))

export const SEED_A = seedFromHex('6a09e667f3bcc908bb67ae8584caa73b3c6ef372fe94f82ba54ff53a5f1d36f1')
export const SEED_B = seedFromHex('510e527fade682d19b05688c2b3e6c1f1f83d9abfb41bd6b5be0cd19137e2179')

/** @p count arbitrary 32-byte seeds, the same on every run. */
export function testSeeds(count: number): Uint8Array[] {
  return Array.from(
    { length: count },
    (_, index) => new Uint8Array(createHash('sha256').update(`package-trust-test-seed-${index}`).digest()),
  )
}

export const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex')

/** A generated trust module with the seed it came from. */
export interface GeneratedModule {
  seed: Uint8Array
  source: string
  layout: TrustModuleLayout
}

/** The development-mode module for @p seed and @p keys (the test key by default). */
export function generateTestModule(seed: Uint8Array, keys: Record<string, string> = TEST_KEYS): GeneratedModule {
  const { source, layout } = generatePackageTrustModule({
    seed,
    keys,
    typesImport: './types',
    header: { mode: 'development' },
  })
  return { seed, source, layout }
}

/** The anchor of the module generated for the test key and @p seed, on @p mechanisms. */
export function testTrustAnchor(
  seed: Uint8Array = SEED_A,
  mechanisms: PackageTrustMechanisms = desktopPackageTrustMechanisms,
): PackageTrustAnchor {
  return loadTrustModule(generateTestModule(seed).source)(mechanisms)
}

/** Environment variable naming a generated module file to test instead of the committed one. */
export const MODULE_UNDER_TEST_ENV = 'OPENPLC_TRUST_MODULE_UNDER_TEST'

export const COMMITTED_MODULE_PATH = join(__dirname, '..', '..', 'package-trust-anchor.ts')

/** The module that holds the real Autonomy key: the committed one, or the file the environment names. */
export interface RealTrustModule {
  path: string
  source: string
  layout: TrustModuleLayout
  create: CreatePackageTrustAnchor
  /** True when the module comes from `OPENPLC_TRUST_MODULE_UNDER_TEST`. */
  fromEnvironment: boolean
  keyId: string
  keyDer: Uint8Array
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Narrows parsed `layout.json` content to a `TrustModuleLayout`. */
export function isTrustModuleLayout(value: unknown): value is TrustModuleLayout {
  if (!isRecord(value) || !Array.isArray(value.sites) || !Array.isArray(value.shareLiterals)) return false
  const sitesOk = value.sites.every(
    (site: unknown) =>
      isRecord(site) && (site.hook === 'import' || site.hook === 'use') && typeof site.functionName === 'string',
  )
  return sitesOk && value.shareLiterals.every((literal: unknown) => typeof literal === 'string')
}

/** Reads the `layout.json` beside a generated module file. */
export function readLayoutBeside(modulePath: string): TrustModuleLayout {
  const parsed: unknown = JSON.parse(readFileSync(join(dirname(modulePath), 'layout.json'), 'utf-8'))
  if (!isTrustModuleLayout(parsed)) throw new Error(`layout.json beside ${modulePath} is not a trust module layout`)
  return parsed
}

/** The development module `write-fallback` writes, generated in process. */
export function developmentModule(): GeneratedModule {
  return generateTestModule(DEVELOPMENT_SEED, TRUSTED_PACKAGE_KEYS)
}

/** The module under test that holds the real Autonomy key. */
export function realTrustModule(): RealTrustModule {
  const keyId = FX3U_KEY_ID
  const keyDer = pemToDer(TRUSTED_PACKAGE_KEYS[keyId])
  const environmentPath = process.env[MODULE_UNDER_TEST_ENV]
  if (environmentPath) {
    const source = readFileSync(environmentPath, 'utf-8')
    return {
      path: environmentPath,
      source,
      layout: readLayoutBeside(environmentPath),
      create: loadTrustModule(source),
      fromEnvironment: true,
      keyId,
      keyDer,
    }
  }
  return {
    path: COMMITTED_MODULE_PATH,
    source: readFileSync(COMMITTED_MODULE_PATH, 'utf-8'),
    layout: developmentModule().layout,
    create: createPackageTrustAnchor,
    fromEnvironment: false,
    keyId,
    keyDer,
  }
}

/** The function names hosting the sites of @p hook, in execution order, without repeats. */
export function siteFunctions(layout: TrustModuleLayout, hook: 'import' | 'use'): string[] {
  return [...new Set(layout.sites.filter((site) => site.hook === hook).map((site) => site.functionName))]
}

/**
 * Replaces each named top-level function of @p source by one that returns, on every call, what the original
 * returned on its first call. Priming the anchor with an accepted package makes each named site accept anything.
 */
export function neutralizeSites(source: string, functionNames: string[]): string {
  let neutralized = source
  let replacements = ''
  for (const name of new Set(functionNames)) {
    const declaration = new RegExp(`\\b(function\\s+|(?:const|let|var)\\s+)${name}\\b(?=\\s*[<(=:])`)
    if (!declaration.test(neutralized)) throw new Error(`No top-level function named ${name} in the module`)
    neutralized = neutralized.replace(declaration, `$1${name}__site`)
    replacements += [
      '',
      `var ${name}__first: { value: unknown } | undefined`,
      `function ${name}(...args: unknown[]): unknown {`,
      `  if (${name}__first === undefined) ${name}__first = { value: Reflect.apply(${name}__site, undefined, args) }`,
      `  return ${name}__first.value`,
      '}',
      '',
    ].join('\n')
  }
  return neutralized + replacements
}

/** Mechanisms that delegate to @p base except for the Ed25519 primitive. */
export function withPrimitive(
  base: PackageTrustMechanisms,
  verifyEd25519: PackageTrustMechanisms['verifyEd25519'],
): PackageTrustMechanisms {
  return {
    readSnapshot: (packageDir) => base.readSnapshot(packageDir),
    verifyEd25519,
    canonicalize: (value) => base.canonicalize(value),
    parseSignatureFile: (raw) => base.parseSignatureFile(raw),
    encodeUtf8: (text) => base.encodeUtf8(text),
    decodeUtf8: (bytes) => base.decodeUtf8(bytes),
    decodeBase64: (value) => base.decodeBase64(value),
    spkiDerToPem: (der) => base.spkiDerToPem(der),
    verifyFileSet: (payload, hashes) => base.verifyFileSet(payload, hashes),
    verifyManifestIdentity: (payload, manifest) => base.verifyManifestIdentity(payload, manifest),
  }
}

/** One call of the Ed25519 primitive, with the answer the anchor received. */
export interface VerifyCall {
  message: Uint8Array
  key: Uint8Array
  signature: Uint8Array
  result: boolean
}

export const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => Buffer.compare(a, b) === 0

/**
 * Mechanisms that record every Ed25519 call. While faulty (the initial state), @p decide turns the real answer
 * into the one returned; `setFaulty(false)` returns the real answer, for priming a neutralized module.
 */
export function recordingMechanisms(
  decide: (call: Omit<VerifyCall, 'result'>, real: boolean) => boolean = (_call, real) => real,
  base: PackageTrustMechanisms = desktopPackageTrustMechanisms,
): { mechanisms: PackageTrustMechanisms; calls: VerifyCall[]; setFaulty: (faulty: boolean) => void } {
  const calls: VerifyCall[] = []
  let faulty = true
  const mechanisms = withPrimitive(base, (message, key, signature) => {
    const real = base.verifyEd25519(message, key, signature)
    const result = faulty ? decide({ message, key, signature }, real) : real
    calls.push({ message, key, signature, result })
    return result
  })
  const setFaulty = (value: boolean): void => {
    faulty = value
  }
  return { mechanisms, calls, setFaulty }
}

/** Flips one character of @p literal to another of the same digit or letter class. */
export function flipCharacter(literal: string, index = 0): string {
  const code = literal.charCodeAt(index)
  const flip = (start: number): number => start + ((code - start) ^ 1)
  let flipped = code
  if (code >= 48 && code <= 57) flipped = flip(48)
  else if (code >= 65 && code <= 90) flipped = flip(65)
  else if (code >= 97 && code <= 122) flipped = flip(97)
  if (flipped === code) throw new Error(`Cannot flip ${literal[index]}`)
  return literal.slice(0, index) + String.fromCharCode(flipped) + literal.slice(index + 1)
}

/** @p source with every quoted occurrence of the string literal @p literal replaced by @p replacement. */
export function replaceLiteral(source: string, literal: string, replacement: string): string {
  let replaced = source
  for (const quote of ["'", '"', '`']) {
    replaced = replaced.split(quote + literal + quote).join(quote + replacement + quote)
  }
  if (replaced === source) throw new Error(`Share literal ${literal} is not in the module`)
  return replaced
}
