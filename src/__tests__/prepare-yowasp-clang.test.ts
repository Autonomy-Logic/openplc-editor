/**
 * scripts/prepare-yowasp-clang.ts run as the package scripts run it, from a temporary repository root holding a
 * copy of the `@yowasp/clang` package.
 * @jest-environment node
 */
import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'

import { afterEach, describe, expect, it } from '@jest/globals'

const repo = join(__dirname, '..', '..')
const script = join(repo, 'scripts', 'prepare-yowasp-clang.ts')
const tsNodeRegister = join(repo, 'node_modules', 'ts-node', 'register', 'index.js')

const ORIGINAL = 'this.#fetchResources(options.fetchProgress ?? defaultFetchProgress)'
const PATCHED = 'this.#fetchResources(options.fetchProgress)'
const NOTICE =
  '// This file was changed from the @yowasp/clang package: a run given no fetchProgress gets no default progress callback.\n'
const installedBundle = readFileSync(join(repo, 'node_modules', '@yowasp', 'clang', 'gen', 'bundle.js'), 'utf8')

/** The package files the prepared copy holds, apart from `gen/bundle.js`. */
const COPIED: Record<string, Uint8Array> = {
  'package.json': new TextEncoder().encode('{"name":"@yowasp/clang","version":"22.0.0-git20542-10"}'),
  'README.md': new TextEncoder().encode('YoWASP Clang/LLD package'),
  'gen/llvm-resources.tar': new Uint8Array([0x75, 0x73, 0x74, 0x61, 0x72, 0, 1, 2]),
  'gen/llvm.core.wasm': new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 0xff]),
  'gen/llvm.core2.wasm': new Uint8Array([0, 0x61, 0x73, 0x6d, 2]),
  'gen/llvm.core3.wasm': new Uint8Array([0, 0x61, 0x73, 0x6d, 3]),
  'gen/llvm.core4.wasm': new Uint8Array([0, 0x61, 0x73, 0x6d, 4]),
  'gen/nested/extra.bin': new Uint8Array([0x1f, 0x8b, 9, 9]),
}

/** Package files outside `package.json`, `README.md` and `gen/**`, which the prepared copy leaves out. */
const LEFT_OUT: Record<string, string> = {
  'lib/api.d.ts': 'export declare function runClang(): void',
  'LICENSE.txt': 'ISC',
}

interface Run {
  code: number
  stdout: string
  stderr: string
}

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function write(file: string, content: string | Uint8Array): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content)
}

const sourceDir = (root: string): string => join(root, 'node_modules', '@yowasp', 'clang')
const preparedDir = (root: string): string => join(root, 'release', 'yowasp-clang')

/** A repository root whose `node_modules/@yowasp/clang` holds `bundle` as its loader. */
function repositoryRoot(bundle: string): string {
  const root = mkdtempSync(join(tmpdir(), 'prepare-yowasp-clang-'))
  roots.push(root)
  write(join(sourceDir(root), 'gen', 'bundle.js'), bundle)
  for (const [name, bytes] of Object.entries(COPIED)) write(join(sourceDir(root), name), bytes)
  for (const [name, text] of Object.entries(LEFT_OUT)) write(join(sourceDir(root), name), text)
  return root
}

/** Every file under `dir`, relative to it, with `/` separators. */
function listFiles(dir: string, under = dir): string[] {
  return readdirSync(under, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(under, entry.name)
      if (entry.isDirectory()) return listFiles(dir, path)
      return entry.isFile() ? [relative(dir, path).split('\\').join('/')] : []
    })
    .sort()
}

/** Every file under `dir` with its bytes. */
const snapshot = (dir: string): Record<string, Uint8Array> =>
  Object.fromEntries(listFiles(dir).map((name) => [name, new Uint8Array(readFileSync(join(dir, name)))]))

function runScript(root: string): Promise<Run> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ['--require', tsNodeRegister, script],
      {
        cwd: root,
        env: { ...process.env, TS_NODE_TRANSPILE_ONLY: 'true', TS_NODE_PROJECT: join(repo, 'tsconfig.json') },
        timeout: 60000,
      },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === 'number' ? error.code : -1
        resolve({ code, stdout, stderr })
      },
    )
  })
}

describe('prepare-yowasp-clang', () => {
  it('writes bundle.js with the change notice and the loader patch applied once to release/yowasp-clang', async () => {
    const root = repositoryRoot(installedBundle)

    const run = await runScript(root)

    expect(run).toMatchObject({ code: 0 })
    const prepared = readFileSync(join(preparedDir(root), 'gen', 'bundle.js'), 'utf8')
    expect(prepared).toBe(NOTICE + installedBundle.replace(ORIGINAL, PATCHED))
    expect(prepared).not.toContain('?? defaultFetchProgress')
  }, 60000)

  it('copies package.json, README.md and every other gen file byte for byte, and nothing else', async () => {
    const root = repositoryRoot(installedBundle)

    const run = await runScript(root)

    expect(run.code).toBe(0)
    expect(listFiles(preparedDir(root))).toEqual(['gen/bundle.js', ...Object.keys(COPIED)].sort())
    for (const [name, bytes] of Object.entries(COPIED)) {
      expect(new Uint8Array(readFileSync(join(preparedDir(root), name)))).toEqual(bytes)
    }
  }, 60000)

  it('leaves no file or folder an earlier run or package version put in release/yowasp-clang', async () => {
    const root = repositoryRoot(installedBundle)
    write(join(preparedDir(root), 'gen', 'llvm.core5.wasm'), new Uint8Array([0, 0x61, 0x73, 0x6d, 5]))
    write(join(preparedDir(root), 'old', 'notes.txt'), 'left from an earlier package version')

    const run = await runScript(root)

    expect(run.code).toBe(0)
    expect(listFiles(preparedDir(root))).toEqual(['gen/bundle.js', ...Object.keys(COPIED)].sort())
    expect(readdirSync(preparedDir(root)).sort()).toEqual(['README.md', 'gen', 'package.json'])
  }, 60000)

  it('never writes the package in node_modules', async () => {
    const root = repositoryRoot(installedBundle)
    const before = snapshot(sourceDir(root))

    const run = await runScript(root)

    expect(run.code).toBe(0)
    expect(snapshot(sourceDir(root))).toEqual(before)
  }, 60000)

  it('gives the same prepared copy when run again', async () => {
    const root = repositoryRoot(installedBundle)
    const first = await runScript(root)
    const once = snapshot(preparedDir(root))

    const second = await runScript(root)

    expect([first.code, second.code]).toEqual([0, 0])
    expect(snapshot(preparedDir(root))).toEqual(once)
  }, 60000)

  it.each([
    ['without the line it patches', 'export const runClang = () => undefined\n', 0],
    ['with the line twice', `a = ${ORIGINAL}\nb = ${ORIGINAL}\n`, 2],
  ])(
    'exits non-zero with the patch message for a loader %s',
    async (_label, bundle, found) => {
      const root = repositoryRoot(bundle)

      const run = await runScript(root)

      expect(run.code).not.toBe(0)
      expect(run.stderr).toContain(`The @yowasp/clang loader patch does not apply (found ${found}).`)
    },
    60000,
  )
})

describe('where the desktop takes the prepared copy from', () => {
  const packageJson: unknown = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))
  const scripts: unknown =
    typeof packageJson === 'object' && packageJson !== null ? Reflect.get(packageJson, 'scripts') : null
  const scriptOf = (name: string): string => {
    const value: unknown = typeof scripts === 'object' && scripts !== null ? Reflect.get(scripts, name) : null
    return typeof value === 'string' ? value : ''
  }

  it.each(['postinstall', 'prestart'])('prepares the copy in the %s script', (name) => {
    expect(scriptOf(name)).toContain('scripts/prepare-yowasp-clang.ts')
  })

  it('prepares the copy at the start of build:main, before webpack runs', () => {
    const buildMain = scriptOf('build:main')
    const prepare = buildMain.indexOf('scripts/prepare-yowasp-clang.ts')

    expect(prepare).toBeGreaterThanOrEqual(0)
    expect(prepare).toBeLessThan(buildMain.indexOf('webpack'))
  })

  it('packages the yowasp-clang extra resource from release/yowasp-clang with the same filter', () => {
    const builder: unknown = JSON.parse(readFileSync(join(repo, 'electron-builder.json'), 'utf8'))
    const extra: unknown =
      typeof builder === 'object' && builder !== null ? Reflect.get(builder, 'extraResources') : null
    const entries: unknown[] = Array.isArray(extra) ? extra : []
    const toolchain = entries.filter(
      (entry) => typeof entry === 'object' && entry !== null && Reflect.get(entry, 'to') === './yowasp-clang',
    )

    expect(toolchain).toEqual([
      { from: './release/yowasp-clang', to: './yowasp-clang', filter: ['package.json', 'README.md', 'gen/**'] },
    ])
  })

  it('keeps the licences entry of the toolchain unchanged', () => {
    const builder: unknown = JSON.parse(readFileSync(join(repo, 'electron-builder.json'), 'utf8'))
    const extra: unknown =
      typeof builder === 'object' && builder !== null ? Reflect.get(builder, 'extraResources') : null
    const entries: unknown[] = Array.isArray(extra) ? extra : []
    const licences = entries.filter(
      (entry) => typeof entry === 'object' && entry !== null && Reflect.get(entry, 'to') === './yowasp-clang/licenses',
    )

    expect(licences).toEqual([{ from: './third-party-licenses/yowasp-clang', to: './yowasp-clang/licenses' }])
  })

  it('keeps the prepared copy out of git', () => {
    const ignored = readFileSync(join(repo, '.gitignore'), 'utf8').split(/\r?\n/)
    const patterns = ignored.map((line) => line.trim().replace(/^\//, '').replace(/\/$/, ''))

    expect(patterns).toContain('release/yowasp-clang')
  })
})
