import * as nodeCrypto from 'node:crypto'
import * as nodeFs from 'node:fs'
import * as nodePath from 'node:path'

import {
  DEVELOPMENT_SEED,
  generatePackageTrustModule,
  type TrustModuleLayout,
} from '../../../../../../scripts/package-trust/generator'
import { loadTrustModule } from '../../../../../../scripts/package-trust/load-module'
import type { SignatureVerification, TrustedKeys } from '../../../../shared/utils/vpp/package-verification-core'
import { TRUSTED_PACKAGE_KEYS } from '../../../../shared/utils/vpp/trusted-keys'
import * as sharedVerifier from '../../../../shared/utils/vpp/verify-package-signature'
import { verifyTrustedPackage } from '../../index'
import type { TrustVerdict, VerifyTrustedPackage } from '../../types'
import { FX3U_KEY_ID, pemToDer, testSigningKey } from './sign-test-package'

/** The throwaway key that plays the Autonomy key in modules generated for tests. */
export const TEST_AUTONOMY_KEY = testSigningKey(
  'test-key',
  '4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb',
)
export const TEST_KEYS: Record<string, string> = { [TEST_AUTONOMY_KEY.keyId]: TEST_AUTONOMY_KEY.publicKeyPem }

/** The refusal of every generated check, which names no site. */
export const REFUSED = 'Package trust check failed'

/** Where the committed fallback imports its types and the shared verifier from. */
export const FALLBACK_TYPES_IMPORT = './types'
export const FALLBACK_VERIFIER_IMPORT = '../../shared/utils/vpp/verify-package-signature'

/** Where a release module, placed in release/package-trust/, imports its types and the shared verifier from. */
export const RELEASE_TYPES_IMPORT = '../../src/backend/editor/package-trust/types'
export const RELEASE_VERIFIER_IMPORT = '../../src/backend/shared/utils/vpp/verify-package-signature'

/** The runtime imports a generated module may have besides the shared verifier. */
export const NODE_IMPORTS = ['node:crypto', 'node:fs', 'node:path'] as const

const seedFromHex = (hex: string): Uint8Array => new Uint8Array(Buffer.from(hex, 'hex'))

export const SEED_A = seedFromHex('6a09e667f3bcc908bb67ae8584caa73b3c6ef372fe94f82ba54ff53a5f1d36f1')
export const SEED_B = seedFromHex('510e527fade682d19b05688c2b3e6c1f1f83d9abfb41bd6b5be0cd19137e2179')

/** @p count arbitrary 32-byte seeds, the same on every run. */
export function testSeeds(count: number): Uint8Array[] {
  return Array.from(
    { length: count },
    (_, index) => new Uint8Array(nodeCrypto.createHash('sha256').update(`package-trust-test-seed-${index}`).digest()),
  )
}

export const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex')

export const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => Buffer.compare(a, b) === 0

/** The shared verifier as a generated module imports it. */
export interface VerifierModule {
  verifyPackageSignature(packageDir: string, trustedKeys: TrustedKeys): SignatureVerification
}

/** Replacements for the modules a generated module imports; each missing one is the real module. */
export interface ImportOverrides {
  crypto?: object
  fs?: object
  path?: object
  verifier?: VerifierModule
}

/**
 * The `imports` of `loadTrustModule` for a module importing the shared verifier from @p verifierImport: each allowed
 * specifier mapped to its module, the real one unless @p overrides replaces it.
 */
export function moduleImports(verifierImport: string, overrides: ImportOverrides = {}): Record<string, unknown> {
  return {
    'node:crypto': overrides.crypto ?? nodeCrypto,
    'node:fs': overrides.fs ?? nodeFs,
    'node:path': overrides.path ?? nodePath,
    [verifierImport]: overrides.verifier ?? sharedVerifier,
  }
}

/** The specifier the module @p source imports the shared verifier from; throws when it has none. */
export function verifierImportOf(source: string): string {
  const match = /from\s+'([^']*\/verify-package-signature)'/.exec(source)
  if (match === null) throw new Error('The trust module does not import the shared verifier')
  return match[1]
}

/** Loads the trust module @p source with its real imports, or the ones @p overrides replaces. */
export function loadModule(source: string, overrides: ImportOverrides = {}): VerifyTrustedPackage {
  return loadTrustModule(source, moduleImports(verifierImportOf(source), overrides))
}

/** A generated trust module with the seed it came from. */
export interface GeneratedModule {
  seed: Uint8Array
  source: string
  layout: TrustModuleLayout
}

/** The development-mode module for @p seed and @p keys (the test key by default), laid out as the fallback is. */
export function generateTestModule(seed: Uint8Array, keys: Record<string, string> = TEST_KEYS): GeneratedModule {
  const { source, layout } = generatePackageTrustModule({
    seed,
    keys,
    typesImport: FALLBACK_TYPES_IMPORT,
    verifierImport: FALLBACK_VERIFIER_IMPORT,
    header: { mode: 'development' },
  })
  return { seed, source, layout }
}

/** The entry point of the module generated for the test key and @p seed, on its real imports. */
export function testVerifyTrustedPackage(seed: Uint8Array = SEED_A): VerifyTrustedPackage {
  return loadModule(generateTestModule(seed).source)
}

/** Environment variable naming a generated module file to test instead of the committed one. */
export const MODULE_UNDER_TEST_ENV = 'OPENPLC_TRUST_MODULE_UNDER_TEST'

export const COMMITTED_MODULE_PATH = nodePath.join(__dirname, '..', '..', 'package-trust-anchor.ts')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Narrows parsed `layout.json` content to a `TrustModuleLayout`. */
export function isTrustModuleLayout(value: unknown): value is TrustModuleLayout {
  if (!isRecord(value) || !Array.isArray(value.sites) || !Array.isArray(value.shareLiterals)) return false
  if (typeof value.entryName !== 'string') return false
  const strings = (items: unknown): boolean =>
    Array.isArray(items) && items.every((item: unknown) => typeof item === 'string')
  const sitesOk = value.sites.every(
    (site: unknown) =>
      isRecord(site) &&
      (site.hook === 'import' || site.hook === 'use') &&
      typeof site.functionName === 'string' &&
      isRecord(site.canaryCases) &&
      strings(site.canaryCases.matching) &&
      strings(site.canaryCases.mismatching),
  )
  return sitesOk && value.shareLiterals.every((literal: unknown) => typeof literal === 'string')
}

/** Reads the `layout.json` beside a generated module file. */
export function readLayoutBeside(modulePath: string): TrustModuleLayout {
  const layoutPath = nodePath.join(nodePath.dirname(modulePath), 'layout.json')
  const parsed: unknown = JSON.parse(nodeFs.readFileSync(layoutPath, 'utf-8'))
  if (!isTrustModuleLayout(parsed)) throw new Error(`layout.json beside ${modulePath} is not a trust module layout`)
  return parsed
}

/** The development module `write-fallback` writes, generated in process. */
export function developmentModule(): GeneratedModule {
  return generateTestModule(DEVELOPMENT_SEED, TRUSTED_PACKAGE_KEYS)
}

/** The module under test that holds the real Autonomy key. */
export interface RealTrustModule {
  path: string
  source: string
  layout: TrustModuleLayout
  /** The entry point as the editor wires it: the committed module, or the file the environment names. */
  verify: VerifyTrustedPackage
  /** The same module loaded from its source, with the imports @p overrides replaces. */
  load(overrides?: ImportOverrides): VerifyTrustedPackage
  /** True when the module comes from `OPENPLC_TRUST_MODULE_UNDER_TEST`. */
  fromEnvironment: boolean
  keyId: string
  keyDer: Uint8Array
}

/** The module under test that holds the real Autonomy key. */
export function realTrustModule(): RealTrustModule {
  const keyId = FX3U_KEY_ID
  const keyDer = pemToDer(TRUSTED_PACKAGE_KEYS[keyId])
  const environmentPath = process.env[MODULE_UNDER_TEST_ENV] ?? ''
  const fromEnvironment = environmentPath !== ''
  const path = fromEnvironment ? environmentPath : COMMITTED_MODULE_PATH
  const source = nodeFs.readFileSync(path, 'utf-8')
  const load = (overrides: ImportOverrides = {}): VerifyTrustedPackage => loadModule(source, overrides)
  return {
    path,
    source,
    layout: fromEnvironment ? readLayoutBeside(path) : developmentModule().layout,
    verify: fromEnvironment ? load() : verifyTrustedPackage,
    load,
    fromEnvironment,
    keyId,
    keyDer,
  }
}

/** The function names hosting the sites of @p hook, in execution order, without repeats. */
export function siteFunctions(layout: TrustModuleLayout, hook: 'import' | 'use'): string[] {
  return [...new Set(layout.sites.filter((site) => site.hook === hook).map((site) => site.functionName))]
}

/** Every site function name of @p layout, without repeats. */
export function allSiteFunctions(layout: TrustModuleLayout): string[] {
  return [...new Set(layout.sites.map((site) => site.functionName))]
}

/** Renames the top-level function @p name of @p source to `<name>__site`; throws when there is none. */
function renameDeclaration(source: string, name: string): string {
  const declaration = new RegExp(`\\b(function\\s+|(?:const|let|var)\\s+)${name}\\b(?=\\s*[<(=:])`)
  if (!declaration.test(source)) throw new Error(`No top-level function named ${name} in the module`)
  return source.replace(declaration, `$1${name}__site`)
}

/**
 * Replaces each named top-level function of @p source by one that returns, on every call, what the original
 * returned on its first call. Priming the module with an accepted package makes each named site accept anything.
 */
export function neutralizeSites(source: string, functionNames: string[]): string {
  let neutralized = source
  let replacements = ''
  for (const name of new Set(functionNames)) {
    neutralized = renameDeclaration(neutralized, name)
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

/** Which site of an isolatable module runs; null runs every site and records each one's first answer. */
export interface SiteControl {
  name: string | null
}

const CONTROL_KEY = '__trustTestSiteControl'

/**
 * Wraps each named top-level function of @p source so that, while `control.name` names another site, it replays the
 * answer of its first call instead of running. The control is read from the `node:path` import, so one load serves
 * every site: prime with `name` null on an accepted package, then name the one site to run.
 */
export function isolatableSites(source: string, functionNames: string[]): string {
  let wrapped = source
  let replacements = `\nimport * as ${CONTROL_KEY} from 'node:path'\n`
  for (const name of new Set(functionNames)) {
    wrapped = renameDeclaration(wrapped, name)
    replacements += [
      '',
      `var ${name}__first: { value: unknown } | undefined`,
      `function ${name}(...args: unknown[]): unknown {`,
      `  const control: unknown = Reflect.get(${CONTROL_KEY}, '${CONTROL_KEY}')`,
      `  const active: unknown = typeof control === 'object' && control !== null ? Reflect.get(control, 'name') : null`,
      `  if (typeof active === 'string' && active !== '${name}' && ${name}__first !== undefined) {`,
      `    return ${name}__first.value`,
      '  }',
      `  const value: unknown = Reflect.apply(${name}__site, undefined, args)`,
      `  if (${name}__first === undefined) ${name}__first = { value }`,
      '  return value',
      '}',
      '',
    ].join('\n')
  }
  return wrapped + replacements
}

/** A `node:path` that carries @p control for a module made by `isolatableSites`. */
export function controlledPath(control: SiteControl): object {
  return { ...nodePath, [CONTROL_KEY]: control }
}

/** A shared verifier that accepts every package: the shared verifier neutralized. */
export const acceptingVerifier: VerifierModule = { verifyPackageSignature: () => ({ valid: true }) }

/**
 * The real shared verifier, recording every key map it receives and verifying with that map widened by @p added:
 * an attacker adding keys to the map the module builds.
 */
export function wideningVerifier(added: Record<string, string> = {}): {
  verifier: VerifierModule
  maps: TrustedKeys[]
} {
  const maps: TrustedKeys[] = []
  const verifier: VerifierModule = {
    verifyPackageSignature: (packageDir, trustedKeys) => {
      maps.push(trustedKeys)
      return sharedVerifier.verifyPackageSignature(packageDir, { ...trustedKeys, ...added })
    },
  }
  return { verifier, maps }
}

/** One call of the Ed25519 primitive the module made, with the SPKI DER of its key and the answer it received. */
export interface VerifyCall {
  message: Uint8Array
  key: Uint8Array
  signature: Uint8Array
  result: boolean
}

function bytesOf(value: unknown): Uint8Array {
  if (typeof value === 'string') return new Uint8Array(Buffer.from(value, 'utf8'))
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice()
  return new Uint8Array(0)
}

/** The SPKI DER of whatever key form the module handed to `node:crypto`. */
function spkiDerOf(key: unknown): Uint8Array {
  const object: unknown =
    key instanceof nodeCrypto.KeyObject ? key : Reflect.apply(nodeCrypto.createPublicKey, nodeCrypto, [key])
  if (!(object instanceof nodeCrypto.KeyObject)) return new Uint8Array(0)
  return new Uint8Array(object.export({ format: 'der', type: 'spki' }))
}

/**
 * A `node:crypto` that records every Ed25519 verify call. While faulty (the initial state), @p decide turns the real
 * answer into the one returned; `setFaulty(false)` returns the real answer, for priming a neutralized module.
 */
export function recordingCrypto(
  decide: (call: Omit<VerifyCall, 'result'>, real: boolean) => boolean = (_call, real) => real,
): { crypto: object; calls: VerifyCall[]; setFaulty: (faulty: boolean) => void } {
  const calls: VerifyCall[] = []
  let faulty = true
  const verify = (...args: unknown[]): unknown => {
    const [, data, key, signature] = args
    const real: unknown = Reflect.apply(nodeCrypto.verify, nodeCrypto, args)
    if (typeof real !== 'boolean') return real
    let der = new Uint8Array(0)
    try {
      der = spkiDerOf(key)
    } catch {
      der = new Uint8Array(0)
    }
    const call = { message: bytesOf(data), key: der, signature: bytesOf(signature) }
    const result = faulty ? decide(call, real) : real
    calls.push({ ...call, result })
    return result
  }
  const setFaulty = (value: boolean): void => {
    faulty = value
  }
  return { crypto: { ...nodeCrypto, verify }, calls, setFaulty }
}

/** A `node:crypto` whose `verify` accepts every signature: the Ed25519 primitive neutralized. */
export function acceptingCrypto(): object {
  return { ...nodeCrypto, verify: () => true }
}

/** A `node:crypto` whose `createHash` gives @p digestHex for any input: sha256 stubbed. */
export function constantHashCrypto(digestHex: string): object {
  const digest = Buffer.from(digestHex, 'hex')
  const createHash = (): object => {
    const hash = {
      update: (): object => hash,
      digest: (encoding?: BufferEncoding): Buffer | string =>
        encoding === undefined ? Buffer.from(digest) : digest.toString(encoding),
      copy: (): object => hash,
    }
    return hash
  }
  return { ...nodeCrypto, createHash }
}

/** A `node:fs` each of whose functions throws: a package the module cannot read. */
export function throwingFs(): object {
  const failing: Record<string, unknown> = {}
  for (const name of Object.keys(nodeFs)) {
    failing[name] = () => {
      throw new Error(`fs.${name} is unavailable`)
    }
  }
  return failing
}

/** The real `node:fs`, counting how many times `readFileSync` read each path. */
export function countingFs(): { fs: object; reads: Map<string, number> } {
  const reads = new Map<string, number>()
  const readFileSync = (...args: unknown[]): unknown => {
    const key = nodePath.resolve(String(args[0]))
    reads.set(key, (reads.get(key) ?? 0) + 1)
    return Reflect.apply(nodeFs.readFileSync, nodeFs, args)
  }
  return { fs: { ...nodeFs, readFileSync }, reads }
}

type MemoryEntry = { kind: 'directory' } | { kind: 'file'; bytes: Buffer }

function statLike(entry: MemoryEntry): Record<string, unknown> {
  const isFile = entry.kind === 'file'
  return {
    isFile: () => isFile,
    isDirectory: () => !isFile,
    isSymbolicLink: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    size: entry.kind === 'file' ? entry.bytes.length : 0,
  }
}

function noEntry(path: string): Error {
  return Object.assign(new Error(`ENOENT: no such file or directory, '${path}'`), { code: 'ENOENT' })
}

/**
 * A `node:fs` holding in memory a copy of the regular files and directories under @p root, at the same absolute
 * paths, so a module reads the same tree without touching the disk. Supports the read calls of a directory walk.
 */
export function memoryFsOf(root: string): object {
  const entries = new Map<string, MemoryEntry>()
  const copy = (dir: string): void => {
    entries.set(nodePath.resolve(dir), { kind: 'directory' })
    for (const name of nodeFs.readdirSync(dir)) {
      const full = nodePath.join(dir, name)
      const stat = nodeFs.lstatSync(full)
      if (stat.isDirectory()) copy(full)
      else if (stat.isFile()) entries.set(nodePath.resolve(full), { kind: 'file', bytes: nodeFs.readFileSync(full) })
    }
  }
  copy(root)

  const entryAt = (path: unknown): MemoryEntry => {
    const found = entries.get(nodePath.resolve(String(path)))
    if (found === undefined) throw noEntry(String(path))
    return found
  }
  const childrenOf = (path: unknown): string[] => {
    const dir = nodePath.resolve(String(path))
    if (entryAt(dir).kind !== 'directory') throw new Error(`ENOTDIR: not a directory, '${dir}'`)
    return [...entries.keys()]
      .filter((key) => key !== dir && nodePath.dirname(key) === dir)
      .map((key) => nodePath.basename(key))
      .sort()
  }
  const encodingOf = (options: unknown): BufferEncoding | undefined => {
    if (typeof options === 'string' && Buffer.isEncoding(options)) return options
    if (isRecord(options) && typeof options.encoding === 'string' && Buffer.isEncoding(options.encoding)) {
      return options.encoding
    }
    return undefined
  }

  const supported: Record<string, unknown> = {
    readdirSync: (path: unknown, options?: unknown) => {
      const names = childrenOf(path)
      if (!isRecord(options) || options.withFileTypes !== true) return names
      return names.map((name) => ({ name, ...statLike(entryAt(nodePath.join(String(path), name))) }))
    },
    lstatSync: (path: unknown, options?: unknown) => {
      if (isRecord(options) && options.throwIfNoEntry === false && !entries.has(nodePath.resolve(String(path)))) {
        return undefined
      }
      return statLike(entryAt(path))
    },
    statSync: (path: unknown) => statLike(entryAt(path)),
    existsSync: (path: unknown) => entries.has(nodePath.resolve(String(path))),
    readFileSync: (path: unknown, options?: unknown) => {
      const entry = entryAt(path)
      if (entry.kind !== 'file') throw new Error(`EISDIR: illegal operation on a directory, read '${String(path)}'`)
      const encoding = encodingOf(options)
      return encoding === undefined ? Buffer.from(entry.bytes) : entry.bytes.toString(encoding)
    },
  }
  const memory: Record<string, unknown> = {}
  for (const name of Object.keys(nodeFs)) {
    memory[name] =
      supported[name] ??
      (() => {
        throw new Error(`The in-memory fs has no ${name}`)
      })
  }
  return memory
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

/**
 * The two source patches of the check canary of @p site, each named: its mismatching case replaced by its matching
 * case, share for share, and one share of its matching case altered. Either must make the site refuse every package.
 */
export function canaryPatches(source: string, site: TrustModuleLayout['sites'][number]): [string, string][] {
  const { matching, mismatching } = site.canaryCases
  if (matching.length === 0 || matching.length !== mismatching.length) {
    throw new Error(`The canary cases of ${site.functionName} do not have the same, non-zero number of shares`)
  }
  const swapped = mismatching.reduce(
    (patched, literal, index) => replaceLiteral(patched, literal, matching[index]),
    source,
  )
  return [
    ['its mismatching case replaced by its matching case', swapped],
    ['its matching case altered', replaceLiteral(source, matching[0], flipCharacter(matching[0]))],
  ]
}

/** The verdict of a package trusted as @p packageId at @p version. */
export function accepted(packageId: string, version: string): TrustVerdict {
  return [true, packageId, version]
}

/** The verdict of a package refused for @p reason. */
export function refused(reason: string = REFUSED): TrustVerdict {
  return [false, reason]
}
