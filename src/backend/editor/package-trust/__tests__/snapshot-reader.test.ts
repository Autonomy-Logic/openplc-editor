/**
 * The snapshot reader of each hook of the generated module, through its entry point with the shared verifier
 * neutralized, so that only the module's own reading of the package decides: entries that are neither a regular file
 * nor a directory, unsafe paths, hashes over the raw bytes, and the same tree served by an in-memory node:fs.
 * @jest-environment node
 */
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DEVELOPMENT_SEED } from '../../../../../scripts/package-trust/generator'
import type { TrustVerdict, VerifyTrustedPackage } from '../types'
import { CORPUS_PACKAGE_ID, CORPUS_VERSION, writeCorpusCase } from './fixtures/equivalence-corpus'
import { extractFx3u, FX3U_PACKAGE_ID } from './fixtures/sign-test-package'
import {
  accepted,
  acceptingVerifier,
  generateTestModule,
  loadModule,
  memoryFsOf,
  realTrustModule,
  refused,
  SEED_A,
  SEED_B,
  throwingFs,
  toHex,
} from './fixtures/trust-test-kit'

const onPosix = process.platform === 'win32' ? it.skip : it
const HOOKS = [true, false] as const
const TIMEOUT = 120000

const MODULES = [SEED_A, SEED_B, DEVELOPMENT_SEED].map((seed) => generateTestModule(seed))
const ACCEPTED = accepted(CORPUS_PACKAGE_ID, CORPUS_VERSION)
const SOURCE = 'int vpp_init(void) { return 0; }'
const BINARY = Uint8Array.from([0, 255, 254, 128, 10, 13, 0xc3, 0x28])
const MANIFEST = JSON.stringify({
  formatVersion: '1.0',
  package: { id: CORPUS_PACKAGE_ID, name: 'Corpus Board', version: CORPUS_VERSION },
  devices: [],
})

let root = ''

beforeEach(() => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'package-trust-reader-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** Writes a package the test key signs over @p files, then applies @p after to its directory. */
function signedPackage(
  name: string,
  files: Record<string, string | Uint8Array> = {},
  after?: (dir: string) => void,
): string {
  return writeCorpusCase(join(root, name), {
    name,
    spec: { files: { 'manifest.json': MANIFEST, 'plugin/main.c': SOURCE, ...files }, after },
  })
}

/** A file outside every package, for links to point at. */
function outsideFile(content: string): string {
  const path = join(root, 'outside', 'target.c')
  mkdirSync(join(root, 'outside'), { recursive: true })
  writeFileSync(path, content)
  return path
}

/** The verdicts at both hooks of every test module, the shared verifier accepting everything, per seed. */
function verdictsBySeed(dir: string, fs?: object): Record<string, TrustVerdict[]> {
  return Object.fromEntries(
    MODULES.map((module) => {
      const verify: VerifyTrustedPackage = loadModule(module.source, { verifier: acceptingVerifier, fs })
      return [toHex(module.seed), HOOKS.map((atImport) => verify(dir, atImport))]
    }),
  )
}

/** What verdictsBySeed gives when every module answers @p verdict at both hooks. */
function everywhere(verdict: TrustVerdict): Record<string, TrustVerdict[]> {
  return Object.fromEntries(MODULES.map((module) => [toHex(module.seed), [verdict, verdict]]))
}

describe('the snapshot reader of modules generated for a test key', () => {
  it(
    'hashes the raw bytes of nested, binary and empty files, accepting the package as signed (positive control)',
    () => {
      const dir = signedPackage('binary', { 'assets/nested/deep/logo.bin': BINARY, 'empty.txt': '' })

      expect(verdictsBySeed(dir)).toEqual(everywhere(ACCEPTED))
    },
    TIMEOUT,
  )

  it(
    'refuses the package once one byte of a binary file changes',
    () => {
      const dir = signedPackage('binary-altered', { 'assets/logo.bin': BINARY }, (pkg) => {
        writeFileSync(join(pkg, 'assets', 'logo.bin'), Uint8Array.from([...BINARY.slice(0, -1), 0x29]))
      })

      expect(verdictsBySeed(dir)).toEqual(everywhere(refused()))
    },
    TIMEOUT,
  )

  onPosix(
    'refuses a symbolic link signed with the hash of the file it points at',
    () => {
      const target = outsideFile('void linked(void) {}')
      const dir = signedPackage('link-signed', { 'plugin/link.c': 'void linked(void) {}' }, (pkg) => {
        rmSync(join(pkg, 'plugin', 'link.c'))
        symlinkSync(target, join(pkg, 'plugin', 'link.c'))
      })

      expect(verdictsBySeed(dir)).toEqual(everywhere(refused()))
    },
    TIMEOUT,
  )

  onPosix(
    'refuses an unsigned symbolic link to a file',
    () => {
      const target = outsideFile('void linked(void) {}')
      const dir = signedPackage('link-file', {}, (pkg) => symlinkSync(target, join(pkg, 'plugin', 'link.c')))

      expect(verdictsBySeed(dir)).toEqual(everywhere(refused()))
    },
    TIMEOUT,
  )

  onPosix(
    'refuses an unsigned symbolic link to a directory',
    () => {
      outsideFile('void linked(void) {}')
      const dir = signedPackage('link-directory', {}, (pkg) => symlinkSync(join(root, 'outside'), join(pkg, 'linked')))

      expect(verdictsBySeed(dir)).toEqual(everywhere(refused()))
    },
    TIMEOUT,
  )

  onPosix(
    'refuses an unsigned FIFO',
    () => {
      const dir = signedPackage('fifo', {}, (pkg) => execFileSync('mkfifo', [join(pkg, 'plugin', 'pipe')]))

      expect(verdictsBySeed(dir)).toEqual(everywhere(refused()))
    },
    TIMEOUT,
  )

  onPosix(
    'refuses a signed file whose path holds a backslash',
    () => {
      const dir = signedPackage('backslash', { 'plugin/a\\b.c': 'void escaped(void) {}' })

      expect(verdictsBySeed(dir)).toEqual(everywhere(refused()))
    },
    TIMEOUT,
  )

  onPosix(
    'accepts a signed path of 512 characters and refuses one of 513',
    () => {
      const longPath = (length: number): string => `${'a'.repeat(200)}/${'b'.repeat(200)}/${'c'.repeat(length - 402)}`
      const at512 = signedPackage('path-512', { [longPath(512)]: 'x' })
      const at513 = signedPackage('path-513', { [longPath(513)]: 'x' })

      expect([verdictsBySeed(at512), verdictsBySeed(at513)]).toEqual([everywhere(ACCEPTED), everywhere(refused())])
    },
    TIMEOUT,
  )

  it(
    'gives the same verdicts when the same tree is served by an in-memory node:fs',
    () => {
      const kept = signedPackage('memory-kept', { 'assets/nested/logo.bin': BINARY })
      const altered = signedPackage('memory-altered', { 'assets/logo.bin': BINARY }, (pkg) => {
        writeFileSync(join(pkg, 'assets', 'logo.bin'), 'altered')
      })

      expect([verdictsBySeed(kept, memoryFsOf(kept)), verdictsBySeed(altered, memoryFsOf(altered))]).toEqual([
        everywhere(ACCEPTED),
        everywhere(refused()),
      ])
    },
    TIMEOUT,
  )

  it(
    'refuses, without throwing, a package it cannot read',
    () => {
      const dir = signedPackage('unreadable')

      expect(verdictsBySeed(dir, throwingFs())).toEqual(everywhere(refused()))
    },
    TIMEOUT,
  )
})

describe('the snapshot reader of the module with the Autonomy key', () => {
  const real = realTrustModule()
  let fx3u = ''

  beforeEach(async () => {
    fx3u = await extractFx3u(join(root, 'fx3u'))
  })

  function realVerdicts(dir: string, fs?: object): TrustVerdict[] {
    const verify = real.load({ verifier: acceptingVerifier, fs })
    return HOOKS.map((atImport) => verify(dir, atImport))
  }

  it('accepts the fx3u package served by an in-memory node:fs (positive control)', () => {
    const expected = accepted(FX3U_PACKAGE_ID, '2.1.0')

    expect([realVerdicts(fx3u), realVerdicts(fx3u, memoryFsOf(fx3u))]).toEqual([
      [expected, expected],
      [expected, expected],
    ])
  })

  onPosix('refuses the fx3u package with an unsigned symbolic link added', () => {
    const copy = join(root, 'fx3u-link')
    cpSync(fx3u, copy, { recursive: true })
    symlinkSync(join(copy, 'manifest.json'), join(copy, 'hal', 'linked.json'))

    expect(realVerdicts(copy)).toEqual([refused(), refused()])
  })

  onPosix('refuses the fx3u package with an unsigned FIFO added', () => {
    const copy = join(root, 'fx3u-fifo')
    cpSync(fx3u, copy, { recursive: true })
    execFileSync('mkfifo', [join(copy, 'hal', 'pipe')])

    expect(realVerdicts(copy)).toEqual([refused(), refused()])
  })
})
