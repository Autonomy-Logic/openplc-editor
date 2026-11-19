import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'

import { TRUSTED_PACKAGE_KEYS } from '../../src/backend/shared/utils/vpp/trusted-keys'
import { checkFingerprint } from './fingerprint'
import {
  DEVELOPMENT_SEED,
  deriveReleaseSeed,
  generatePackageTrustModule,
  isRecord,
  parseModuleHeader,
  parseTrustModuleLayout,
  type TrustModuleLayout,
} from './generator'
import { loadTrustModule } from './load-module'

const FALLBACK_MODULE = 'src/backend/editor/package-trust/package-trust-anchor.ts'
const PLACED_MODULE = 'release/package-trust/package-trust-anchor.ts'
const PLACED_LAYOUT = 'release/package-trust/layout.json'
const RELEASE_PACKAGE_JSON = 'release/app/package.json'
const MAIN_BUNDLE = 'release/app/dist/main/main.js'
const BUNDLE_LABEL = `${MAIN_BUNDLE} with its chunks`
const RELEASE_TYPES_IMPORT = '../../src/backend/editor/package-trust/types'
const SECRET_VARIABLE = 'OPENPLC_TRUST_SEED_SECRET'
const RELEASE_VARIABLE = 'OPENPLC_RELEASE_BUILD'
const TEST_PACKAGE_VARIABLE = 'OPENPLC_TEST_PACKAGE'

const USAGE = [
  'Usage: ts-node scripts/package-trust/cli.ts <command> [--root <repository>]',
  '  write-fallback                                        regenerate the committed development module',
  '  generate-release --version <v> --commit <sha> --out <file>  generate a release module (needs the seed secret)',
  '  prepare                                               place the module the main bundle is built with',
  '  verify-bundle                                         check the main bundle holds the placed module',
].join('\n')

const FLAGS: Record<string, string[]> = {
  'write-fallback': ['--root'],
  'generate-release': ['--root', '--version', '--commit', '--out'],
  prepare: ['--root'],
  'verify-bundle': ['--root'],
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
  const result = checkFingerprint(loadTrustModule(source), TRUSTED_PACKAGE_KEYS)
  if (!result.ok) throw new CliFailure(`${label}: ${result.error}`)
}

/** Writes @p source to @p path and the layout to `layout.json` beside it. */
function writeModuleWithLayout(path: string, source: string, layout: TrustModuleLayout): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, source)
  writeFileSync(join(dirname(path), 'layout.json'), `${JSON.stringify(layout, null, 2)}\n`)
}

function developmentModule(typesImport: string): { source: string; layout: TrustModuleLayout } {
  return generatePackageTrustModule({
    seed: DEVELOPMENT_SEED,
    keys: TRUSTED_PACKAGE_KEYS,
    typesImport,
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

function readPlacedLayout(root: string): TrustModuleLayout {
  const text = readText(root, PLACED_LAYOUT, 'run the prepare command first')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new CliFailure(`${PLACED_LAYOUT} is not JSON`)
  }
  const layout = parseTrustModuleLayout(parsed)
  if (layout === null || layout.shareLiterals.length === 0)
    throw new CliFailure(`${PLACED_LAYOUT} is not a module layout`)
  return layout
}

function writeFallback(invocation: Invocation): void {
  const { source } = developmentModule('./types')
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
  const { source, layout } = developmentModule(RELEASE_TYPES_IMPORT)
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
  readPlacedLayout(root)
  console.log(`package-trust: ${PLACED_MODULE} is the release module for ${header.version} at ${header.commit}`)
}

function prepare(invocation: Invocation): void {
  if (isReleaseMode()) prepareRelease(invocation.root)
  else prepareDevelopment(invocation.root)
}

/** The text of `main.js` and of every other script beside it: the chunks it loads and the other main-process entries. */
function readMainBundle(root: string): string {
  const entry = readText(root, MAIN_BUNDLE, 'build the main bundle first')
  const directory = dirname(inRoot(root, MAIN_BUNDLE))
  const others = readdirSync(directory)
    .filter((name) => name.endsWith('.js') && name !== basename(MAIN_BUNDLE))
    .sort()
    .map((name) => readFileSync(join(directory, name), 'utf-8'))
  return [entry, ...others].join('\n')
}

function verifyBundle(invocation: Invocation): void {
  const release = isReleaseMode()
  const bundle = readMainBundle(invocation.root)
  const module = readText(invocation.root, PLACED_MODULE, 'run the prepare command first')
  const layout = readPlacedLayout(invocation.root)
  if (layout.shareLiterals.some((literal) => !module.includes(literal))) {
    throw new CliFailure(`${PLACED_LAYOUT} does not describe ${PLACED_MODULE}`)
  }
  const missing = layout.shareLiterals.filter((literal) => !bundle.includes(literal))
  if (missing.length > 0) {
    throw new CliFailure(`${BUNDLE_LABEL} lacks ${missing.length} share literal(s) of ${PLACED_MODULE}`)
  }
  if (release) {
    const leaked = developmentModule('./types').layout.shareLiterals.filter((literal) => bundle.includes(literal))
    if (leaked.length > 0) {
      throw new CliFailure(
        `${BUNDLE_LABEL} holds ${leaked.length} share literal(s) of the committed development module`,
      )
    }
  }
  console.log(`package-trust: ${BUNDLE_LABEL} holds the ${release ? 'release' : 'development'} module`)
}

const COMMANDS: Record<string, (invocation: Invocation) => void> = {
  'write-fallback': writeFallback,
  'generate-release': generateRelease,
  prepare,
  'verify-bundle': verifyBundle,
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

process.exitCode = main(process.argv.slice(2))
