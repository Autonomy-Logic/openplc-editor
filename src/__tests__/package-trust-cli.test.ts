/**
 * scripts/package-trust/cli.ts run as the package scripts and the release workflows run it, one ts-node process per
 * call, against a temporary repository root.
 * @jest-environment node
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals'

import {
  deriveReleaseSeed,
  generatePackageTrustModule,
  type TrustModuleLayout,
} from '../../scripts/package-trust/generator'
import { listFiles } from '../backend/editor/package-trust/__tests__/fixtures/sign-test-package'
import {
  COMMITTED_MODULE_PATH,
  developmentModule,
  flipCharacter,
  readLayoutBeside,
  replaceLiteral,
} from '../backend/editor/package-trust/__tests__/fixtures/trust-test-kit'
import { TRUSTED_PACKAGE_KEYS } from '../backend/shared/utils/vpp/trusted-keys'

const repo = join(__dirname, '..', '..')
const cli = join(repo, 'scripts', 'package-trust', 'cli.ts')
const tsNodeRegister = join(repo, 'node_modules', 'ts-node', 'register', 'index.js')

const SECRET = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'
const VERSION = '4.3.5'
const COMMIT = 'b657afce48407566c1bcba9d94cb9fe359855428'
const SEED = Buffer.from('3ee6b0137153fce5144d02aacebac13284f0b980cc28efd0da8c6ceee4faaa6e', 'hex')
const SECRET_FORMS = [SECRET, SEED.toString('hex'), SEED.toString('hex').toUpperCase(), SEED.toString('base64')]

const MODULE = join('release', 'package-trust', 'package-trust-anchor.ts')
const MODULE_POSIX = 'release/package-trust/package-trust-anchor.ts'
const LAYOUT = join('release', 'package-trust', 'layout.json')
const FALLBACK_POSIX = 'src/backend/editor/package-trust/package-trust-anchor.ts'
const BUNDLE = join('release', 'app', 'dist', 'main', 'main.js')
const RELEASE_TYPES_IMPORT = '../../src/backend/editor/package-trust/types'
const TIMEOUT = 120000

/** Variables the CLI reads, cleared from the inherited environment so each run sets only its own. */
const CONTROLLED = [
  'OPENPLC_RELEASE_BUILD',
  'OPENPLC_TEST_PACKAGE',
  'OPENPLC_TRUST_SEED_SECRET',
  'OPENPLC_TRUST_MODULE_UNDER_TEST',
  'GITHUB_REF',
]

/** Exit status of one CLI run; `output` is stdout followed by stderr. */
type Run = { status: number; output: string }

function readField(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined
}

function environment(variables: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TS_NODE_TRANSPILE_ONLY: 'true',
    TS_NODE_PROJECT: join(repo, 'tsconfig.json'),
  }
  for (const name of CONTROLLED) delete env[name]
  return { ...env, ...variables }
}

function runCli(args: string[], cwd: string, variables: Record<string, string> = {}): Run {
  try {
    const stdout = execFileSync(process.execPath, ['--require', tsNodeRegister, cli, ...args], {
      cwd,
      env: environment(variables),
      encoding: 'utf-8',
      stdio: 'pipe',
    })
    return { status: 0, output: stdout }
  } catch (error) {
    const status = readField(error, 'status')
    const stdout = readField(error, 'stdout')
    const stderr = readField(error, 'stderr')
    return {
      status: typeof status === 'number' ? status : -1,
      output: `${typeof stdout === 'string' ? stdout : ''}${typeof stderr === 'string' ? stderr : ''}`,
    }
  }
}

function git(root: string, args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args],
    { cwd: root, encoding: 'utf-8', stdio: 'pipe' },
  ).trim()
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

/** A bundle holding each of @p literals as a string literal, as the minified main.js does. */
function writeBundle(root: string, literals: string[]): void {
  write(join(root, BUNDLE), `"use strict";var t=[${literals.map((literal) => JSON.stringify(literal)).join(',')}];\n`)
}

/** A dynamic-import chunk named @p name beside main.js, holding each of @p literals as a string literal. */
function writeChunk(root: string, name: string, literals: string[]): void {
  write(
    join(dirname(join(root, BUNDLE)), name),
    `"use strict";exports.ids=[722];exports.t=[${literals.map((literal) => JSON.stringify(literal)).join(',')}];\n`,
  )
}

const firstLine = (text: string): string => text.split('\n')[0]

let root = ''

beforeEach(() => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'package-trust-cli-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('write-fallback', () => {
  it(
    'writes the committed development module byte for byte, and nothing else',
    () => {
      const run = runCli(['write-fallback', '--root', root], root)

      expect(run.status).toBe(0)
      expect(listFiles(root)).toEqual([FALLBACK_POSIX])
      expect(readFileSync(join(root, FALLBACK_POSIX), 'utf-8')).toBe(readFileSync(COMMITTED_MODULE_PATH, 'utf-8'))
    },
    TIMEOUT,
  )
})

describe('generate-release', () => {
  const out = (): string => join(root, MODULE)

  it.each([
    ['absent', undefined],
    ['shorter than 64 hex characters', SECRET.slice(2)],
    ['64 characters that are not hex', 'g'.repeat(64)],
  ])(
    'ABUSE-14: fails naming OPENPLC_TRUST_SEED_SECRET when the secret is %s, writing nothing',
    (_label, secret) => {
      mkdirSync(dirname(out()), { recursive: true })

      const run = runCli(
        ['generate-release', '--version', VERSION, '--commit', COMMIT, '--out', out(), '--root', root],
        root,
        secret === undefined ? {} : { OPENPLC_TRUST_SEED_SECRET: secret },
      )

      expect(run.status).toBe(1)
      expect(run.output).toContain('OPENPLC_TRUST_SEED_SECRET')
      expect(listFiles(root)).toEqual([])
    },
    TIMEOUT,
  )

  it(
    'writes only --out and layout.json beside it: the module of the derived seed and its layout',
    () => {
      write(join(root, 'keep.txt'), 'untouched')
      mkdirSync(dirname(out()), { recursive: true })
      const before = listFiles(root)

      const run = runCli(
        ['generate-release', '--version', VERSION, '--commit', COMMIT, '--out', out(), '--root', root],
        root,
        { OPENPLC_TRUST_SEED_SECRET: SECRET },
      )

      const expected = generatePackageTrustModule({
        seed: deriveReleaseSeed(SECRET, VERSION, COMMIT),
        keys: TRUSTED_PACKAGE_KEYS,
        typesImport: RELEASE_TYPES_IMPORT,
        header: { mode: 'release', version: VERSION, commit: COMMIT },
      })
      expect(run.status).toBe(0)
      expect(listFiles(root)).toEqual([...before, 'release/package-trust/layout.json', MODULE_POSIX].sort())
      expect(readFileSync(out(), 'utf-8')).toBe(expected.source)
      expect(readLayoutBeside(out())).toEqual(expected.layout)
    },
    TIMEOUT,
  )

  it(
    'ABUSE-09: prints and writes no form of the seed and not the secret',
    () => {
      mkdirSync(dirname(out()), { recursive: true })

      const run = runCli(
        ['generate-release', '--version', VERSION, '--commit', COMMIT, '--out', out(), '--root', root],
        root,
        { OPENPLC_TRUST_SEED_SECRET: SECRET },
      )

      const written = listFiles(root)
        .map((file) => readFileSync(join(root, file), 'utf-8'))
        .join('\n')
      expect(run.status).toBe(0)
      expect(SECRET_FORMS.filter((form) => run.output.includes(form) || written.includes(form))).toEqual([])
    },
    TIMEOUT,
  )
})

describe('prepare in development mode', () => {
  it.each([
    ['no GITHUB_REF', {}],
    ['a branch GITHUB_REF', { GITHUB_REF: 'refs/heads/development' }],
    ['a pull request GITHUB_REF', { GITHUB_REF: 'refs/pull/1/merge' }],
  ])(
    'writes the development module into release/package-trust with %s',
    (_label, variables) => {
      const run = runCli(['prepare', '--root', root], root, variables)

      const placed = readFileSync(join(root, MODULE), 'utf-8')
      expect(run.status).toBe(0)
      expect(firstLine(placed)).toBe(firstLine(readFileSync(COMMITTED_MODULE_PATH, 'utf-8')))
      expect(developmentModule().layout.shareLiterals.filter((literal) => !placed.includes(literal))).toEqual([])
    },
    TIMEOUT,
  )

  it(
    'works in the current directory when no --root is given',
    () => {
      const run = runCli(['prepare'], root)

      expect(run.status).toBe(0)
      expect(existsSync(join(root, MODULE))).toBe(true)
    },
    TIMEOUT,
  )

  it(
    'fails a tag build that is not in release mode, writing no module',
    () => {
      const run = runCli(['prepare', '--root', root], root, { GITHUB_REF: 'refs/tags/v9.9.9' })

      expect(run.status).toBe(1)
      expect(run.output).toMatch(/GITHUB_REF|OPENPLC_RELEASE_BUILD/)
      expect(existsSync(join(root, MODULE))).toBe(false)
    },
    TIMEOUT,
  )
})

describe('release mode', () => {
  const RELEASE = { OPENPLC_RELEASE_BUILD: '1' }
  let template = ''
  let commit = ''

  beforeAll(() => {
    template = mkdtempSync(join(realpathSync(tmpdir()), 'package-trust-release-'))
    write(
      join(template, 'release', 'app', 'package.json'),
      JSON.stringify({ name: 'open-plc-editor', version: VERSION }),
    )
    git(template, ['init', '-q'])
    git(template, ['add', '-A'])
    git(template, ['commit', '-q', '-m', 'fixture'])
    commit = git(template, ['rev-parse', 'HEAD'])
    mkdirSync(join(template, 'release', 'package-trust'), { recursive: true })
    const generated = runCli(
      [
        'generate-release',
        '--version',
        VERSION,
        '--commit',
        commit,
        '--out',
        join(template, MODULE),
        '--root',
        template,
      ],
      template,
      { OPENPLC_TRUST_SEED_SECRET: SECRET },
    )
    if (generated.status !== 0) throw new Error(`generate-release failed: ${generated.output}`)
  }, TIMEOUT)

  afterAll(() => {
    rmSync(template, { recursive: true, force: true })
  })

  /**
   * A copy of the release root as a build job has it: a repository at `commit` with only the release module in
   * release/package-trust, as the trust-module artifact delivers it, and no layout.json.
   */
  function releaseRoot(): string {
    cpSync(template, root, { recursive: true })
    rmSync(join(root, LAYOUT))
    return root
  }

  /** The layout generate-release wrote beside the release module, kept in the template only. */
  function releaseLayout(): TrustModuleLayout {
    return readLayoutBeside(join(template, MODULE))
  }

  function releaseLiterals(): string[] {
    return releaseLayout().shareLiterals
  }

  /** The bundle a build makes: half of @p literals in main.js and the other half in the chunk 722.js. */
  function writeSplitBundle(literals: string[]): void {
    const half = Math.ceil(literals.length / 2)
    writeBundle(root, literals.slice(0, half))
    writeChunk(root, '722.js', literals.slice(half))
  }

  /** layout.json files an earlier step can leave beside the module; none of them may change a result. */
  const LEFTOVER_LAYOUTS: [string, () => string][] = [
    [
      'a stale layout.json listing all but the first share literal',
      () => `${JSON.stringify({ ...releaseLayout(), shareLiterals: releaseLiterals().slice(1) }, null, 2)}\n`,
    ],
    ['the layout.json of another module, the development one', () => `${JSON.stringify(developmentModule().layout)}\n`],
    ['a layout.json with no share literal', () => '{ "sites": [], "shareLiterals": [] }\n'],
    ['a malformed layout.json', () => '{ "sites": [\n'],
  ]

  /** What release/package-trust may hold beside the module: nothing, as the artifact delivers it, or a leftover. */
  const LAYOUT_STATES: [string, (() => string) | null][] = [['no layout.json', null], ...LEFTOVER_LAYOUTS]

  function writeLeftoverLayout(content: (() => string) | null): void {
    if (content !== null) write(join(root, LAYOUT), content())
  }

  const LACKS_FIRST_LITERAL = `release/app/dist/main/main.js with its chunks lacks 1 share literal(s) of ${MODULE_POSIX}`
  const HOLDS_DEVELOPMENT_LITERAL =
    'release/app/dist/main/main.js with its chunks holds 1 share literal(s) of the committed development module'

  describe('prepare', () => {
    it(
      'passes with only the module placed and leaves it as it was (positive control)',
      () => {
        const before = readFileSync(join(releaseRoot(), MODULE), 'utf-8')

        const run = runCli(['prepare', '--root', root], root, RELEASE)

        expect(run.status).toBe(0)
        expect(readFileSync(join(root, MODULE), 'utf-8')).toBe(before)
      },
      TIMEOUT,
    )

    it(
      'ABUSE-14: fails naming OPENPLC_TEST_PACKAGE when the test-only flag is set',
      () => {
        releaseRoot()

        const run = runCli(['prepare', '--root', root], root, { ...RELEASE, OPENPLC_TEST_PACKAGE: '1' })

        expect(run.status).toBe(1)
        expect(run.output).toContain('OPENPLC_TEST_PACKAGE')
      },
      TIMEOUT,
    )

    it(
      'fails naming the path when the module is missing, and generates none',
      () => {
        rmSync(join(releaseRoot(), MODULE))

        const run = runCli(['prepare', '--root', root], root, RELEASE)

        expect(run.status).toBe(1)
        expect(run.output).toContain(MODULE_POSIX)
        expect(existsSync(join(root, MODULE))).toBe(false)
      },
      TIMEOUT,
    )

    it(
      'fails naming both versions when the module was made for another version',
      () => {
        write(
          join(releaseRoot(), 'release', 'app', 'package.json'),
          JSON.stringify({ name: 'open-plc-editor', version: '4.3.6' }),
        )

        const run = runCli(['prepare', '--root', root], root, RELEASE)

        expect(run.status).toBe(1)
        expect([run.output.includes(VERSION), run.output.includes('4.3.6')]).toEqual([true, true])
      },
      TIMEOUT,
    )

    it(
      'fails naming both commits when the module was made for another commit',
      () => {
        write(join(releaseRoot(), 'later.txt'), 'a later commit')
        git(root, ['add', 'later.txt'])
        git(root, ['commit', '-q', '-m', 'later'])
        const later = git(root, ['rev-parse', 'HEAD'])

        const run = runCli(['prepare', '--root', root], root, RELEASE)

        expect(run.status).toBe(1)
        expect([run.output.includes(commit), run.output.includes(later)]).toEqual([true, true])
      },
      TIMEOUT,
    )

    it(
      'ABUSE-17: fails naming the fingerprint mismatch when the module recombines another key',
      () => {
        const path = join(releaseRoot(), MODULE)
        let source = readFileSync(path, 'utf-8')
        for (const literal of releaseLiterals()) {
          source = replaceLiteral(source, literal, flipCharacter(literal))
        }
        writeFileSync(path, source)

        const run = runCli(['prepare', '--root', root], root, RELEASE)

        expect(run.status).toBe(1)
        expect(run.output).toContain('fingerprint mismatch')
      },
      TIMEOUT,
    )

    it(
      'fails naming the module when it builds the right key with no share literal left, after the fingerprint check',
      () => {
        const path = join(releaseRoot(), MODULE)
        let source = readFileSync(path, 'utf-8')
        for (const literal of releaseLiterals()) {
          source = replaceLiteral(source, literal, `${literal.slice(0, 1)}' + '${literal.slice(1)}`)
        }
        writeFileSync(path, source)

        const run = runCli(['prepare', '--root', root], root, RELEASE)

        expect(run.status).toBe(1)
        expect(run.output).toContain(`${MODULE_POSIX} has no share literals`)
        expect(run.output).not.toContain('layout.json')
      },
      TIMEOUT,
    )

    it.each(LEFTOVER_LAYOUTS)(
      'passes with %s beside the module',
      (_label, content) => {
        const before = readFileSync(join(releaseRoot(), MODULE), 'utf-8')
        writeLeftoverLayout(content)

        const run = runCli(['prepare', '--root', root], root, RELEASE)

        expect(run.status).toBe(0)
        expect(readFileSync(join(root, MODULE), 'utf-8')).toBe(before)
      },
      TIMEOUT,
    )
  })

  describe('verify-bundle', () => {
    it(
      'passes a bundle holding every share literal of the release module',
      () => {
        writeBundle(releaseRoot(), releaseLiterals())

        expect(runCli(['verify-bundle', '--root', root], root, RELEASE).status).toBe(0)
      },
      TIMEOUT,
    )

    it(
      'fails a bundle that also holds a share literal of the committed development module',
      () => {
        const development = developmentModule().layout.shareLiterals
        writeBundle(releaseRoot(), [...releaseLiterals(), development[0]])

        const run = runCli(['verify-bundle', '--root', root], root, RELEASE)

        expect(run.status).toBe(1)
        expect(run.output).toContain(HOLDS_DEVELOPMENT_LITERAL)
      },
      TIMEOUT,
    )

    it(
      'fails a bundle missing a share literal of the release module',
      () => {
        writeBundle(releaseRoot(), releaseLiterals().slice(1))

        const run = runCli(['verify-bundle', '--root', root], root, RELEASE)

        expect(run.status).toBe(1)
        expect(run.output).toContain(LACKS_FIRST_LITERAL)
      },
      TIMEOUT,
    )

    it(
      'passes a bundle whose share literals are only in a chunk beside main.js',
      () => {
        writeBundle(releaseRoot(), [])
        writeChunk(root, '722.js', releaseLiterals())

        expect(runCli(['verify-bundle', '--root', root], root, RELEASE).status).toBe(0)
      },
      TIMEOUT,
    )

    it(
      'fails a bundle with a share literal of the development module in a chunk beside main.js',
      () => {
        writeBundle(releaseRoot(), releaseLiterals())
        writeChunk(root, '41.js', [developmentModule().layout.shareLiterals[0]])

        const run = runCli(['verify-bundle', '--root', root], root, RELEASE)

        expect(run.status).toBe(1)
        expect(run.output).toContain(HOLDS_DEVELOPMENT_LITERAL)
      },
      TIMEOUT,
    )

    it.each(LAYOUT_STATES)(
      'passes a bundle split between main.js and the chunk 722.js with %s beside the module',
      (_label, content) => {
        releaseRoot()
        writeLeftoverLayout(content)
        writeSplitBundle(releaseLiterals())

        expect(runCli(['verify-bundle', '--root', root], root, RELEASE).status).toBe(0)
      },
      TIMEOUT,
    )

    it.each(LEFTOVER_LAYOUTS)(
      'fails a split bundle missing the first share literal with %s beside the module, naming the lack',
      (_label, content) => {
        releaseRoot()
        writeLeftoverLayout(content)
        writeSplitBundle(releaseLiterals().slice(1))

        const run = runCli(['verify-bundle', '--root', root], root, RELEASE)

        expect(run.status).toBe(1)
        expect(run.output).toContain(LACKS_FIRST_LITERAL)
        expect(run.output).not.toContain('layout.json')
      },
      TIMEOUT,
    )
  })
})

describe('verify-bundle in development mode', () => {
  it(
    'passes a bundle holding every share literal of the development module',
    () => {
      expect(runCli(['prepare', '--root', root], root).status).toBe(0)
      writeBundle(root, developmentModule().layout.shareLiterals)

      expect(runCli(['verify-bundle', '--root', root], root).status).toBe(0)
    },
    TIMEOUT,
  )

  it(
    'fails a bundle missing a share literal of the development module',
    () => {
      expect(runCli(['prepare', '--root', root], root).status).toBe(0)
      writeBundle(root, developmentModule().layout.shareLiterals.slice(1))

      expect(runCli(['verify-bundle', '--root', root], root).status).toBe(1)
    },
    TIMEOUT,
  )

  it(
    'passes a bundle holding every share literal of the development module with layout.json removed after prepare',
    () => {
      expect(runCli(['prepare', '--root', root], root).status).toBe(0)
      rmSync(join(root, LAYOUT), { force: true })
      writeBundle(root, developmentModule().layout.shareLiterals)

      expect(runCli(['verify-bundle', '--root', root], root).status).toBe(0)
    },
    TIMEOUT,
  )
})
