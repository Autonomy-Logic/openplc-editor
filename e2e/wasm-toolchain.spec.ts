/**
 * The in-editor WebAssembly toolchain on the desktop.
 *
 * While the splash is up the editor only checks that the toolchain's files are there, starting no clang worker, and
 * then shows the main window. The renderer compiles through its CompilerPort: each build runs on one clang worker
 * thread that has ended when the build resolves, and two builds at once share it. A toolchain whose files are
 * missing keeps the splash up with the missing file and a Quit button.
 *
 * The build cases share the worker's editor. Edge cases that launch their own editor: the cold start (startup worker
 * counts), the missing toolchain (another working directory) and the packaged app.
 *
 * Running needs a production build; see "Electron e2e" in CLAUDE.md.
 * Opt-in: E2E_PACKAGED_APP, the executable of a packaged build (`npm run package`), also runs the compile case
 * against that build, where the patched clang package ships as an extra resource outside the asar archive.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import type { ElectronApplication, Page } from '@playwright/test'
import { _electron as electron, expect } from '@playwright/test'

import { compileThroughPort, runAnswer } from './helpers/compiler-port'
import { shutdown } from './helpers/electron-editor'
import {
  copyPreload,
  freshDirectory,
  freshProfile,
  launchEditor,
  mainWindowShown,
  test,
} from './helpers/editor-session'
import { countOf, resetWorkerThreadPeaks, trackWorkerThreads, workerThreads } from './helpers/worker-threads'

const MAIN = join(__dirname, '..', 'release', 'app', 'dist', 'main', 'main.js')
// Resolved before launching from another directory, so a repository-relative path works too.
const PACKAGED_APP = process.env.E2E_PACKAGED_APP ? resolve(__dirname, '..', process.env.E2E_PACKAGED_APP) : ''

/** Launches an editor of its own on a new profile from `cwd`, the packaged executable when given. */
function launchIn(cwd: string, executablePath?: string): Promise<ElectronApplication> {
  copyPreload()
  const userData = freshProfile('wasm-toolchain')
  return electron.launch({
    ...(executablePath
      ? { executablePath, args: [`--user-data-dir=${userData}`] }
      : { args: [MAIN, `--user-data-dir=${userData}`] }),
    cwd,
    env: { ...process.env, NODE_ENV: 'production' },
  })
}

async function windowByUrl(app: ElectronApplication, part: string): Promise<Page> {
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    const page = app.windows().find((w) => w.url().includes(part))
    if (page) return page
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(
    `No window whose URL contains ${part}; open: ${app
      .windows()
      .map((w) => w.url())
      .join(', ')}`,
  )
}

/** A two-unit C and C++ request whose `answer` returns 42; `token` makes its sources new to the session cache. */
const answerProgram = (token: string) => ({
  files: {
    'core.c': `int core(void) { return 41; } /* ${token} */`,
    'main.cpp':
      `#include <string>\n/* ${token} */\nextern "C" int core(void);\n` +
      'extern "C" __attribute__((export_name("answer"))) int answer() { std::string s("x"); return core() + (int)s.size(); }',
  },
  units: [
    { source: 'core.c', language: 'c' as const, flags: ['-std=c99'] },
    { source: 'main.cpp', language: 'c++' as const, flags: ['-std=gnu++17', '-fno-exceptions'] },
  ],
  linkFlags: ['-mexec-model=reactor'],
})

/** A one-unit request returning `value` from `answer`; `token` makes it new to the session cache. */
const answerRequest = (value: number, token: string) => ({
  files: {
    [`answer${value}.c`]: `__attribute__((export_name("answer"))) int answer(void) { return ${value}; } /* ${token} */`,
  },
  units: [{ source: `answer${value}.c`, language: 'c' as const, flags: ['-std=c99'] }],
  linkFlags: ['-mexec-model=reactor'],
})

const LOADER_NOTICE =
  '// This file was changed from the @yowasp/clang package: a run given no fetchProgress gets no default progress callback.\n'

/** Clang worker threads alive now, as the inspector has reported them. */
async function liveClangWorkers(app: ElectronApplication): Promise<number> {
  return countOf((await workerThreads(app)).live, 'clang-worker.js')
}

/** Clang worker threads started since tracking began. */
async function startedClangWorkers(app: ElectronApplication): Promise<number> {
  return countOf((await workerThreads(app)).started, 'clang-worker.js')
}

/** Right after startup: no clang worker and no Python thread exist. */
async function startsNothing(app: ElectronApplication): Promise<void> {
  await trackWorkerThreads(app)
  const atStartup = await workerThreads(app)
  expect(countOf(atStartup.live, 'clang-worker.js')).toBe(0)
  expect(countOf(atStartup.live, 'python-worker.js')).toBe(0)
}

/**
 * Compiles, recompiles from the cache, reports a syntax error, runs two builds at once and refuses an invalid path,
 * all through the CompilerPort. Each build runs on one clang worker that has ended once it resolves; the two at once
 * share one, and no Python thread starts.
 */
async function compilesThroughThePort(app: ElectronApplication, page: Page): Promise<void> {
  await trackWorkerThreads(app)
  await resetWorkerThreadPeaks(app)
  const token = `t${Date.now()}${Math.random().toString(36).slice(2)}`
  const pythonBefore = countOf((await workerThreads(app)).started, 'python-worker.js')
  const request = answerProgram(token)

  const beforeFirst = await startedClangWorkers(app)
  const first = await compileThroughPort(page, request)
  expect(first.messages).toEqual([])
  expect(first.ok).toBe(true)
  expect(await runAnswer(first.wasm)).toBe(42)
  expect(await startedClangWorkers(app)).toBeGreaterThan(beforeFirst)
  await expect.poll(() => liveClangWorkers(app), { timeout: 10000 }).toBe(0)

  const again = await compileThroughPort(page, request)
  expect(again).toMatchObject({ ok: true, cached: 2 })

  const broken = await compileThroughPort(page, {
    files: { 'x.c': `int f( { /* ${token} */` },
    units: [{ source: 'x.c', language: 'c' }],
  })
  expect(broken.ok).toBe(false)
  expect(broken.messages.some((m) => m.includes('x.c:1:'))).toBe(true)
  await expect.poll(() => liveClangWorkers(app), { timeout: 10000 }).toBe(0)

  const startedBefore = await startedClangWorkers(app)
  const [seven, eight] = await Promise.all([
    compileThroughPort(page, answerRequest(7, token)),
    compileThroughPort(page, answerRequest(8, token)),
  ])
  expect([seven.ok, eight.ok]).toEqual([true, true])
  expect([await runAnswer(seven.wasm), await runAnswer(eight.wasm)]).toEqual([7, 8])
  const afterBoth = await workerThreads(app)
  expect(countOf(afterBoth.started, 'clang-worker.js') - startedBefore).toBe(1)
  expect(afterBoth.maxLive['clang-worker.js']).toBe(1)
  await expect.poll(() => liveClangWorkers(app), { timeout: 10000 }).toBe(0)

  const invalid = await compileThroughPort(page, {
    files: { '__proto__/x.c': 'int x;' },
    units: [{ source: '__proto__/x.c', language: 'c' }],
  })
  expect(invalid.ok).toBe(false)
  expect(invalid.messages).toEqual(["Invalid toolchain file path '__proto__/x.c': '__proto__' is not allowed."])
  expect(countOf((await workerThreads(app)).started, 'python-worker.js')).toBe(pythonBefore)
}

test.describe('WebAssembly toolchain (desktop)', () => {
  test.setTimeout(180000)

  test('cold start: the editor starts no clang worker and no Python thread', async () => {
    const { app } = await launchEditor('cold-start')
    try {
      await startsNothing(app)
    } finally {
      await shutdown(app)
    }
  })

  test('each build runs on one clang worker that ends with it, and two builds at once share it', async ({ editor }) => {
    await compilesThroughThePort(editor.app, editor.page)
  })

  test('packaged app: starts no clang worker and compiles with the patched loader', async () => {
    test.skip(PACKAGED_APP === '', 'Set E2E_PACKAGED_APP to a packaged build to run this case.')
    const cwd = join(freshDirectory('packaged'), 'cwd')
    mkdirSync(cwd, { recursive: true })
    const app = await launchIn(cwd, PACKAGED_APP)
    try {
      const page = await windowByUrl(app, 'index.html')
      await expect.poll(() => mainWindowShown(app), { timeout: 120000 }).toBe(true)
      await startsNothing(app)
      await compilesThroughThePort(app, page)
      const resourcesPath = await app.evaluate(() => process.resourcesPath)
      const bundle = readFileSync(join(resourcesPath, 'yowasp-clang', 'gen', 'bundle.js'), 'utf8')
      expect(bundle.startsWith(LOADER_NOTICE)).toBe(true)
      expect(bundle).toContain('this.#fetchResources(options.fetchProgress)')
      expect(bundle).not.toContain('this.#fetchResources(options.fetchProgress ?? defaultFetchProgress)')
      const licenses = join(resourcesPath, 'yowasp-clang', 'licenses')
      for (const file of [
        'LICENSE.txt',
        'llvm-project/LICENSE.TXT',
        'llvm-project/libcxx/LICENSE.TXT',
        'wasi-libc/LICENSE',
        'wasi-libc/libc-top-half/musl/COPYRIGHT',
      ]) {
        expect(existsSync(join(licenses, file)), file).toBe(true)
      }
    } finally {
      app.process().kill('SIGKILL')
    }
  })

  test('missing toolchain: keeps the splash up naming the missing file, and Quit closes the app', async () => {
    const cwd = join(freshDirectory('missing-toolchain'), 'cwd')
    mkdirSync(cwd, { recursive: true })
    const app = await launchIn(cwd)
    const proc = app.process()
    try {
      const splash = await windowByUrl(app, 'error=')
      await expect(splash.getByText('OpenPLC Editor could not start')).toBeVisible()
      await expect(splash.getByText(/The WebAssembly compiler could not be loaded/)).toBeVisible()
      await expect(
        splash.getByText(`Missing toolchain file: ${join(cwd, 'release', 'yowasp-clang', 'gen', 'bundle.js')}`, {
          exact: false,
        }),
      ).toBeVisible()
      expect(await mainWindowShown(app)).toBe(false)

      const exited = new Promise<number | null>((resolve) => proc.once('exit', (code) => resolve(code)))
      await splash.getByRole('button', { name: 'Quit' }).click()
      expect(await exited).toBe(0)
    } finally {
      if (proc.exitCode === null) proc.kill('SIGKILL')
    }
  })
})
