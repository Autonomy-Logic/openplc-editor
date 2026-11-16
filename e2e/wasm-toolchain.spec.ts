/**
 * The in-editor WebAssembly toolchain on the desktop.
 *
 * While the splash is up the editor only checks that the toolchain's files are there, starting no clang worker, and
 * then shows the main window. The renderer compiles through its CompilerPort: each build runs on one clang worker
 * thread that has ended when the build resolves, and two builds at once share it. A toolchain whose files are
 * missing keeps the splash up with the missing file and a Quit button.
 *
 * Running needs a production build plus the preload copy; see "Electron e2e" in CLAUDE.md.
 * Opt-in: E2E_PACKAGED_APP, the executable of a packaged build (`npm run package`), also runs the compile case
 * against that build, where the patched clang package ships as an extra resource outside the asar archive.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import type { ElectronApplication, Page } from '@playwright/test'
import { _electron as electron, expect, test } from '@playwright/test'

import { compileThroughPort, runAnswer } from './helpers/compiler-port'
import { countOf, trackWorkerThreads, workerThreads } from './helpers/worker-threads'

const ROOT = join(realpathSync(tmpdir()), 'openplc-e2e-wasm-toolchain')
const MAIN = join(__dirname, '..', 'release', 'app', 'dist', 'main', 'main.js')
// Resolved before launching from another directory, so a repository-relative path works too.
const PACKAGED_APP = process.env.E2E_PACKAGED_APP ? resolve(__dirname, '..', process.env.E2E_PACKAGED_APP) : ''

function launch(slug: string, cwd?: string, executablePath?: string): Promise<ElectronApplication> {
  const userData = join(ROOT, slug, 'userdata')
  rmSync(join(ROOT, slug), { recursive: true, force: true })
  mkdirSync(userData, { recursive: true })
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

/** True once the main window has been shown, which the editor does only after the toolchain's files are checked. */
const mainWindowShown = (app: ElectronApplication): Promise<boolean> =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().includes('index.html') && w.isVisible()),
  )

const REQUEST = {
  files: {
    'core.c': 'int core(void) { return 41; }',
    'main.cpp':
      '#include <string>\nextern "C" int core(void);\n' +
      'extern "C" __attribute__((export_name("answer"))) int answer() { std::string s("x"); return core() + (int)s.size(); }',
  },
  units: [
    { source: 'core.c', language: 'c' as const, flags: ['-std=c99'] },
    { source: 'main.cpp', language: 'c++' as const, flags: ['-std=gnu++17', '-fno-exceptions'] },
  ],
  linkFlags: ['-mexec-model=reactor'],
}

/** A one-unit request returning `value` from `answer`, so two of them compile separately. */
const answerRequest = (value: number) => ({
  files: { [`answer${value}.c`]: `__attribute__((export_name("answer"))) int answer(void) { return ${value}; }` },
  units: [{ source: `answer${value}.c`, language: 'c' as const, flags: ['-std=c99'] }],
  linkFlags: ['-mexec-model=reactor'],
})

const LOADER_NOTICE =
  '// This file was changed from the @yowasp/clang package: a run given no fetchProgress gets no default progress callback.\n'

test.describe('WebAssembly toolchain (desktop)', () => {
  test.setTimeout(180000)

  const liveClangWorkers = async (app: ElectronApplication): Promise<number> =>
    countOf((await workerThreads(app)).live, 'clang-worker.js')

  const compilesThroughThePort = async (app: ElectronApplication): Promise<void> => {
    const page = await windowByUrl(app, 'index.html')
    await expect.poll(() => mainWindowShown(app), { timeout: 120000 }).toBe(true)

    await trackWorkerThreads(app)
    const atStartup = await workerThreads(app)
    expect(countOf(atStartup.live, 'clang-worker.js')).toBe(0)
    expect(countOf(atStartup.live, 'python-worker.js')).toBe(0)

    const first = await compileThroughPort(page, REQUEST)
    expect(first.messages).toEqual([])
    expect(first.ok).toBe(true)
    expect(await runAnswer(first.wasm)).toBe(42)
    expect(countOf((await workerThreads(app)).started, 'clang-worker.js')).toBeGreaterThan(0)
    await expect.poll(() => liveClangWorkers(app), { timeout: 10000 }).toBe(0)

    const again = await compileThroughPort(page, REQUEST)
    expect(again).toMatchObject({ ok: true, cached: 2 })

    const broken = await compileThroughPort(page, {
      files: { 'x.c': 'int f( {' },
      units: [{ source: 'x.c', language: 'c' }],
    })
    expect(broken.ok).toBe(false)
    expect(broken.messages.some((m) => m.includes('x.c:1:'))).toBe(true)
    await expect.poll(() => liveClangWorkers(app), { timeout: 10000 }).toBe(0)

    const startedBefore = countOf((await workerThreads(app)).started, 'clang-worker.js')
    const [seven, eight] = await Promise.all([
      compileThroughPort(page, answerRequest(7)),
      compileThroughPort(page, answerRequest(8)),
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
    expect(countOf((await workerThreads(app)).started, 'python-worker.js')).toBe(0)
  }

  test('starts no clang worker at startup, and each build runs on one clang worker that ends with it', async () => {
    const app = await launch('ready')
    try {
      await compilesThroughThePort(app)
    } finally {
      app.process().kill('SIGKILL')
    }
  })

  test('compiles in a packaged build', async () => {
    test.skip(PACKAGED_APP === '', 'Set E2E_PACKAGED_APP to a packaged build to run this case.')
    const cwd = join(ROOT, 'packaged', 'cwd')
    rmSync(join(ROOT, 'packaged'), { recursive: true, force: true })
    mkdirSync(cwd, { recursive: true })
    const app = await launch('packaged-run', cwd, PACKAGED_APP)
    try {
      await compilesThroughThePort(app)
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

  test('keeps the splash up naming the missing toolchain file, and Quit closes the app', async () => {
    const cwd = join(ROOT, 'missing', 'cwd')
    rmSync(join(ROOT, 'missing'), { recursive: true, force: true })
    mkdirSync(cwd, { recursive: true })
    const app = await launch('missing-run', cwd)
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
