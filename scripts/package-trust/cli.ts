import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'

import { TRUSTED_PACKAGE_KEYS } from '../../src/backend/shared/utils/vpp/trusted-keys'
import { checkFingerprint } from './fingerprint'
import {
  CROSS_SEED_PROBE,
  DEVELOPMENT_SEED,
  deriveReleaseSeed,
  generatePackageTrustModule,
  isRecord,
  parseModuleHeader,
  shareLiteralsFromSource,
  type TrustModuleLayout,
} from './generator'

const FALLBACK_MODULE = 'src/backend/editor/package-trust/package-trust-anchor.ts'
const PLACED_DIRECTORY = 'release/package-trust'
const PLACED_MODULE = `${PLACED_DIRECTORY}/package-trust-anchor.ts`
const RELEASE_PACKAGE_JSON = 'release/app/package.json'
const MAIN_DIRECTORY = 'release/app/dist/main'
const MAIN_BUNDLE = `${MAIN_DIRECTORY}/main.js`
const BUNDLE_LABEL = `${MAIN_BUNDLE} with its chunks`
const MAIN_WEBPACK_CONFIG = 'configs/webpack/webpack.config.main.prod.ts'
const FALLBACK_TYPES_IMPORT = './types'
const FALLBACK_VERIFIER_IMPORT = '../../shared/utils/vpp/verify-package-signature'
const RELEASE_TYPES_IMPORT = '../../src/backend/editor/package-trust/types'
const RELEASE_VERIFIER_IMPORT = '../../src/backend/shared/utils/vpp/verify-package-signature'
const SECRET_VARIABLE = 'OPENPLC_TRUST_SEED_SECRET'
const RELEASE_VARIABLE = 'OPENPLC_RELEASE_BUILD'
const TEST_PACKAGE_VARIABLE = 'OPENPLC_TEST_PACKAGE'

/** Names that identify the trust path the same way in every release; no main-process bundle may hold one. */
export const FORBIDDEN_TRUST_NAMES = [
  'checkAtImport',
  'checkAtUse',
  'trustedKeys',
  'verifyFileSet:',
  'verifyManifestIdentity:',
  'verifyEd25519',
  'readSnapshot',
  '.anchor.',
] as const

/**
 * How each forbidden name is found in minified code: a name as a whole identifier (not inside `trustedKeysJson`), a
 * name with a colon as an object key, and `.anchor.` as a member of an `anchor` field read through `this`.
 */
const FORBIDDEN_TRUST_PATTERNS: [string, RegExp][] = FORBIDDEN_TRUST_NAMES.map((name) => {
  if (name === '.anchor.') return [name, /(?<![\w$])this\.anchor\./]
  const tail = name.endsWith(':') ? '' : '(?![\\w$])'
  return [name, new RegExp(`(?<![\\w$])${name}${tail}`)]
})

/** Fixed text beside the import call site and beside the use call site of the trust check in the main bundle. */
const CALL_SITE_CONTEXTS = [
  ['import', 'Package signature verification failed'],
  ['use', 'registry entry has no package path'],
] as const

/** How many characters on each side of a call site's fixed text its token sequence covers. */
const CALL_SITE_REACH = 500

const USAGE = [
  'Usage: ts-node scripts/package-trust/cli.ts <command> [--root <repository>]',
  '  write-fallback                                        regenerate the committed development module',
  '  generate-release --version <v> --commit <sha> --out <file>  generate a release module (needs the seed secret)',
  '  prepare                                               place the module the main bundle is built with',
  '  verify-bundle                                         check the main bundle holds the placed module',
  '  cross-seed-check                                      build the main bundle with two seeds and compare them',
].join('\n')

const FLAGS: Record<string, string[]> = {
  'write-fallback': ['--root'],
  'generate-release': ['--root', '--version', '--commit', '--out'],
  prepare: ['--root'],
  'verify-bundle': ['--root'],
  'cross-seed-check': ['--root'],
}

/** A refusal whose message names the cause; the CLI prints it and exits with code 1. */
class CliFailure extends Error {}

interface Invocation {
  command: string
  flags: Map<string, string>
  root: string
}

function parseInvocation(argv: string[]): Invocation {
  const [command, ...rest] = argv
  const allowed = command === undefined ? undefined : FLAGS[command]
  if (allowed === undefined) throw new CliFailure(`Unknown command ${command ?? '(none)'}\n${USAGE}`)
  const flags = new Map<string, string>()
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index]
    const value = rest[index + 1]
    if (!allowed.includes(flag)) throw new CliFailure(`${command} does not take ${flag}\n${USAGE}`)
    if (value === undefined || value.startsWith('--')) throw new CliFailure(`${flag} needs a value`)
    flags.set(flag, value)
  }
  return { command, flags, root: resolve(flags.get('--root') ?? process.cwd()) }
}

function requiredFlag(invocation: Invocation, flag: string): string {
  const value = invocation.flags.get(flag)
  if (value === undefined || value.length === 0) throw new CliFailure(`${invocation.command} needs ${flag}`)
  return value
}

const inRoot = (root: string, posixPath: string): string => join(root, ...posixPath.split('/'))

function requireFingerprint(source: string, label: string): void {
  const result = checkFingerprint(source, TRUSTED_PACKAGE_KEYS)
  if (!result.ok) throw new CliFailure(`${label}: ${result.error}`)
}

/** Writes @p source to @p path and the layout to `layout.json` beside it. */
function writeModuleWithLayout(path: string, source: string, layout: TrustModuleLayout): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, source)
  writeFileSync(join(dirname(path), 'layout.json'), `${JSON.stringify(layout, null, 2)}\n`)
}

/** The development-mode module of @p seed, importing from where the committed fallback or the placed module sits. */
function developmentModule(
  placed: boolean,
  seed: Uint8Array = DEVELOPMENT_SEED,
): { source: string; layout: TrustModuleLayout } {
  return generatePackageTrustModule({
    seed,
    keys: TRUSTED_PACKAGE_KEYS,
    typesImport: placed ? RELEASE_TYPES_IMPORT : FALLBACK_TYPES_IMPORT,
    verifierImport: placed ? RELEASE_VERIFIER_IMPORT : FALLBACK_VERIFIER_IMPORT,
    header: { mode: 'development' },
  })
}

function isReleaseMode(): boolean {
  const value = process.env[RELEASE_VARIABLE] ?? ''
  if (value === '' || value === '1') return value === '1'
  throw new CliFailure(`${RELEASE_VARIABLE} must be 1 or unset, not ${JSON.stringify(value)}`)
}

function readText(root: string, posixPath: string, missing: string): string {
  const path = inRoot(root, posixPath)
  if (!existsSync(path)) throw new CliFailure(`${posixPath} is missing: ${missing}`)
  return readFileSync(path, 'utf-8')
}

/** The share literals of the placed module @p source; throws when it has none. */
function placedShareLiterals(source: string): string[] {
  const literals = shareLiteralsFromSource(source)
  if (literals.length === 0) throw new CliFailure(`${PLACED_MODULE} has no share literals`)
  return literals
}

function writeFallback(invocation: Invocation): void {
  const { source } = developmentModule(false)
  requireFingerprint(source, 'the development module')
  const path = inRoot(invocation.root, FALLBACK_MODULE)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, source)
  console.log(`package-trust: wrote ${FALLBACK_MODULE}`)
}

function generateRelease(invocation: Invocation): void {
  const secret = process.env[SECRET_VARIABLE] ?? ''
  if (!/^[0-9a-fA-F]{64}$/.test(secret)) {
    throw new CliFailure(`${SECRET_VARIABLE} is not set or is not 64 hexadecimal characters`)
  }
  const version = requiredFlag(invocation, '--version')
  const commit = requiredFlag(invocation, '--commit')
  const out = resolve(invocation.root, requiredFlag(invocation, '--out'))
  const generated = generatePackageTrustModule({
    seed: deriveReleaseSeed(secret, version, commit),
    keys: TRUSTED_PACKAGE_KEYS,
    typesImport: RELEASE_TYPES_IMPORT,
    verifierImport: RELEASE_VERIFIER_IMPORT,
    header: { mode: 'release', version, commit },
  })
  requireFingerprint(generated.source, 'the generated release module')
  writeModuleWithLayout(out, generated.source, generated.layout)
  console.log(
    `package-trust: wrote the release module for ${version} at ${commit} to ${relative(invocation.root, out)}`,
  )
}

function prepareDevelopment(root: string): void {
  const ref = process.env.GITHUB_REF ?? ''
  if (ref.startsWith('refs/tags/v')) {
    throw new CliFailure(
      `GITHUB_REF is the release tag ${ref} but ${RELEASE_VARIABLE} is not 1: a tag build must bundle the release module`,
    )
  }
  const { source, layout } = developmentModule(true)
  requireFingerprint(source, 'the development module')
  writeModuleWithLayout(inRoot(root, PLACED_MODULE), source, layout)
  console.log(`package-trust: placed the development module at ${PLACED_MODULE}`)
}

function prepareRelease(root: string): void {
  if ((process.env[TEST_PACKAGE_VARIABLE] ?? '') !== '') {
    throw new CliFailure(`${TEST_PACKAGE_VARIABLE} is set: a release build never uses the test-only package settings`)
  }
  const source = readText(root, PLACED_MODULE, 'a release build bundles the module generate-release made')
  const header = parseModuleHeader(source.split('\n')[0])
  if (header === null || header.mode !== 'release') throw new CliFailure(`${PLACED_MODULE} is not a release module`)

  const packageJson: unknown = JSON.parse(readText(root, RELEASE_PACKAGE_JSON, 'the release version is unknown'))
  const version = isRecord(packageJson) ? packageJson.version : undefined
  if (header.version !== version) {
    throw new CliFailure(
      `${PLACED_MODULE} was generated for version ${header.version}, but ${RELEASE_PACKAGE_JSON} has version ${String(version)}`,
    )
  }
  let head: string
  try {
    head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf-8', stdio: 'pipe' }).trim()
  } catch {
    throw new CliFailure(`git rev-parse HEAD failed in ${root}`)
  }
  if (header.commit !== head) {
    throw new CliFailure(`${PLACED_MODULE} was generated for commit ${header.commit}, but HEAD is ${head}`)
  }
  requireFingerprint(source, PLACED_MODULE)
  placedShareLiterals(source)
  console.log(`package-trust: ${PLACED_MODULE} is the release module for ${header.version} at ${header.commit}`)
}

function prepare(invocation: Invocation): void {
  if (isReleaseMode()) prepareRelease(invocation.root)
  else prepareDevelopment(invocation.root)
}

/** `main.js` and every other script beside it (the chunks it loads, the other main-process entries), with their text. */
function readMainBundleFiles(root: string): [string, string][] {
  const entry = readText(root, MAIN_BUNDLE, 'build the main bundle first')
  const directory = inRoot(root, MAIN_DIRECTORY)
  const others = readdirSync(directory)
    .filter((name) => name.endsWith('.js') && name !== basename(MAIN_BUNDLE))
    .sort()
    .map((name): [string, string] => [`${MAIN_DIRECTORY}/${name}`, readFileSync(join(directory, name), 'utf-8')])
  return [[MAIN_BUNDLE, entry], ...others]
}

const bundleText = (files: [string, string][]): string => files.map(([, text]) => text).join('\n')

/** The forbidden trust names @p text holds. */
const forbiddenNamesIn = (text: string): string[] =>
  FORBIDDEN_TRUST_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([name]) => name)

function verifyBundle(invocation: Invocation): void {
  const release = isReleaseMode()
  const files = readMainBundleFiles(invocation.root)
  const bundle = bundleText(files)
  const placed = placedShareLiterals(readText(invocation.root, PLACED_MODULE, 'run the prepare command first'))
  const missing = placed.filter((literal) => !bundle.includes(literal))
  if (missing.length > 0) {
    throw new CliFailure(`${BUNDLE_LABEL} lacks ${missing.length} share literal(s) of ${PLACED_MODULE}`)
  }
  if (release) {
    const leaked = shareLiteralsFromSource(developmentModule(false).source).filter((literal) =>
      bundle.includes(literal),
    )
    if (leaked.length > 0) {
      throw new CliFailure(
        `${BUNDLE_LABEL} holds ${leaked.length} share literal(s) of the committed development module`,
      )
    }
  }
  const forbidden = files.flatMap(([file, text]) => forbiddenNamesIn(text).map((name) => `${name} in ${file}`))
  if (forbidden.length > 0) {
    throw new CliFailure(`${BUNDLE_LABEL} holds fixed trust names: ${forbidden.join(', ')}`)
  }
  console.log(`package-trust: ${BUNDLE_LABEL} holds the ${release ? 'release' : 'development'} module`)
}

/** The token sequence of the text within CALL_SITE_REACH characters of @p context in @p bundle. */
function tokensAround(bundle: string, site: string, context: string): string {
  const at = bundle.indexOf(context)
  if (at < 0) throw new Error(`the bundle has no ${site} call site: its fixed text "${context}" is missing`)
  const window = bundle.slice(Math.max(0, at - CALL_SITE_REACH), at + context.length + CALL_SITE_REACH)
  const tokens = window.match(/[A-Za-z_$][\w$]*|\d[\w.]*|\S/g) ?? []
  return tokens.slice(1, -1).join(' ')
}

/**
 * The minified token sequences of the import call site and of the use call site of the trust check in @p bundleText,
 * each found by the fixed text beside it. Text farther than a few thousand characters from both sites changes neither.
 * @throws {Error} when the fixed text of a call site is missing
 */
export function callSiteTokens(bundleText: string): [string, string] {
  const [[importSite, importContext], [useSite, useContext]] = CALL_SITE_CONTEXTS
  return [tokensAround(bundleText, importSite, importContext), tokensAround(bundleText, useSite, useContext)]
}

/** One build of the cross-seed check: the text of `main.js` and its chunks, and the share literals of its module. */
export interface CrossSeedBuild {
  bundle: string
  shareLiterals: string[]
}

/**
 * Passes only when both call sites are found in both builds, each call site's tokens differ between them, neither
 * bundle holds a forbidden trust name, and each bundle holds every share literal of its own module. The failures name
 * the call site, the build, the name or the literal, and never a seed.
 */
export function crossSeedVerdict(
  builds: [CrossSeedBuild, CrossSeedBuild],
): { ok: true } | { ok: false; failures: string[] } {
  const failures: string[] = []
  const tokens = builds.map(({ bundle }, index) => {
    try {
      return callSiteTokens(bundle)
    } catch (error) {
      failures.push(`build ${index + 1}: ${error instanceof Error ? error.message : String(error)}`)
      return null
    }
  })
  const [first, second] = tokens
  if (first !== null && second !== null) {
    CALL_SITE_CONTEXTS.forEach(([site], index) => {
      if (first[index] === second[index]) failures.push(`the ${site} call site has the same tokens in both builds`)
    })
  }
  builds.forEach(({ bundle, shareLiterals }, index) => {
    for (const name of forbiddenNamesIn(bundle)) failures.push(`build ${index + 1} holds the fixed trust name ${name}`)
    for (const literal of shareLiterals) {
      if (!bundle.includes(literal)) failures.push(`build ${index + 1} lacks the share literal ${literal}`)
    }
  })
  return failures.length === 0 ? { ok: true } : { ok: false, failures }
}

/** A directory of the root that a cross-seed build replaces, saved so it can be put back as it was. */
interface SavedDirectory {
  path: string
  copy: string | null
  createdParents: string[]
}

function saveDirectory(root: string, posixPath: string, backup: string): SavedDirectory {
  const path = inRoot(root, posixPath)
  const createdParents: string[] = []
  for (let parent = dirname(path); parent.startsWith(root) && !existsSync(parent); parent = dirname(parent)) {
    createdParents.push(parent)
  }
  if (!existsSync(path)) return { path, copy: null, createdParents }
  const copy = join(backup, basename(path))
  cpSync(path, copy, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true })
  return { path, copy, createdParents }
}

function restoreDirectory(saved: SavedDirectory): void {
  rmSync(saved.path, { recursive: true, force: true })
  if (saved.copy !== null) {
    cpSync(saved.copy, saved.path, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true })
    return
  }
  for (const parent of saved.createdParents) {
    if (existsSync(parent) && readdirSync(parent).length === 0) rmdirSync(parent)
  }
}

/** Builds the main bundle of @p root as `build:main` does, with the development-mode module of @p seed placed. */
function buildWithSeed(root: string, webpackCli: string, seed: Uint8Array, label: string): CrossSeedBuild {
  const { source } = developmentModule(true, seed)
  requireFingerprint(source, `the module of ${label}`)
  const placed = inRoot(root, PLACED_MODULE)
  rmSync(inRoot(root, PLACED_DIRECTORY), { recursive: true, force: true })
  mkdirSync(dirname(placed), { recursive: true })
  writeFileSync(placed, source)
  rmSync(inRoot(root, MAIN_DIRECTORY), { recursive: true, force: true })
  try {
    execFileSync(process.execPath, [webpackCli, '--config', `./${MAIN_WEBPACK_CONFIG}`], {
      cwd: root,
      env: { ...process.env, NODE_ENV: 'production', TS_NODE_TRANSPILE_ONLY: 'true' },
      stdio: ['ignore', 'inherit', 'inherit'],
    })
  } catch {
    throw new CliFailure(`the main bundle of ${label} did not build`)
  }
  return { bundle: bundleText(readMainBundleFiles(root)), shareLiterals: shareLiteralsFromSource(source) }
}

function crossSeedCheck(invocation: Invocation): void {
  const { root } = invocation
  if (!existsSync(inRoot(root, MAIN_WEBPACK_CONFIG))) {
    throw new CliFailure(`${MAIN_WEBPACK_CONFIG} is missing: ${root} cannot be built`)
  }
  let webpackCli: string
  try {
    webpackCli = createRequire(join(root, 'package.json')).resolve('webpack-cli/bin/cli.js')
  } catch {
    throw new CliFailure(`webpack-cli is not installed in ${root}: install the dependencies first`)
  }
  const backup = mkdtempSync(join(tmpdir(), 'package-trust-cross-seed-'))
  const saved = [PLACED_DIRECTORY, MAIN_DIRECTORY].map((path, index) =>
    saveDirectory(root, path, join(backup, `${index}`)),
  )
  let verdict: ReturnType<typeof crossSeedVerdict>
  try {
    const first = buildWithSeed(root, webpackCli, DEVELOPMENT_SEED, 'build 1 (the development seed)')
    const second = buildWithSeed(root, webpackCli, CROSS_SEED_PROBE, 'build 2 (the cross-seed probe)')
    verdict = crossSeedVerdict([first, second])
  } finally {
    for (const directory of saved) restoreDirectory(directory)
    rmSync(backup, { recursive: true, force: true })
  }
  if (!verdict.ok) throw new CliFailure(`cross-seed check failed:\n  ${verdict.failures.join('\n  ')}`)
  console.log('package-trust: cross-seed check passed: both call sites differ between the two builds')
}

const COMMANDS: Record<string, (invocation: Invocation) => void> = {
  'write-fallback': writeFallback,
  'generate-release': generateRelease,
  prepare,
  'verify-bundle': verifyBundle,
  'cross-seed-check': crossSeedCheck,
}

/** Runs the command of @p argv; exit code 0 when it passes, 1 with a message naming the cause otherwise. */
function main(argv: string[]): number {
  try {
    const invocation = parseInvocation(argv)
    COMMANDS[invocation.command](invocation)
    return 0
  } catch (error) {
    console.error(`package-trust: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2))
