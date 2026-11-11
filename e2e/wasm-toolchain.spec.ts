/**
 * The in-editor WebAssembly toolchain on the desktop.
 *
 * The editor loads clang while the splash is up and only then shows the main window; the renderer compiles
 * through the CompilerPort bridge and gets a module back. A toolchain that cannot load keeps the splash up with
 * the reason and a Quit button.
 *
 * Running needs a production build plus the preload copy; see "Electron e2e" in CLAUDE.md.
 * Opt-in: E2E_PACKAGED_APP, the executable of a packaged build (`npm run package`), also runs the compile case
 * against that build, where clang ships as an extra resource outside the asar archive.
 */
import { mkdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ElectronApplication, Page } from '@playwright/test'
import { _electron as electron, expect, test } from '@playwright/test'

const ROOT = join(realpathSync(tmpdir()), 'openplc-e2e-wasm-toolchain')
const MAIN = join(__dirname, '..', 'release', 'app', 'dist', 'main', 'main.js')
const PACKAGED_APP = process.env.E2E_PACKAGED_APP ?? ''

function launch(slug: string, cwd?: string, executablePath?: string): Promise<ElectronApplication> {
  const userData = join(ROOT, slug, 'userdata')
  rmSync(join(ROOT, slug), { recursive: true, force: true })
  mkdirSync(userData, { recursive: true })
  return electron.launch({
    ...(executablePath
      ? { executablePath, args: [`--user-data-dir=${userData}`] }
      : { args: [MAIN, `--user-data-dir=${userData}`] }),
    cwd,
    // NOT development: `resolveHtmlPath` would point the window at the webpack dev server.
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

/** True once the main window has been shown, which the editor does only after the toolchain is ready. */
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

test.describe('WebAssembly toolchain (desktop)', () => {
  test.setTimeout(180000)

  const compilesThroughTheBridge = async (app: ElectronApplication): Promise<void> => {
    const page = await windowByUrl(app, 'index.html')
    await expect.poll(() => mainWindowShown(app), { timeout: 120000 }).toBe(true)

    const first = await page.evaluate(async (request) => {
      const result = await window.bridge.wasmToolchainCompile(request)
      return {
        ok: result.ok,
        cached: result.stats.cached,
        wasm: result.ok ? Array.from(result.wasm) : [],
        diagnostics: result.diagnostics,
      }
    }, REQUEST)
    expect(first.diagnostics).toEqual([])
    expect(first.ok).toBe(true)
    const { instance } = await WebAssembly.instantiate(new Uint8Array(first.wasm), {
      wasi_snapshot_preview1: new Proxy({}, { get: () => () => 0 }),
    })
    const answer = instance.exports.answer
    expect(typeof answer === 'function' ? answer() : undefined).toBe(42)

    const again = await page.evaluate(async (request) => {
      const result = await window.bridge.wasmToolchainCompile(request)
      return { ok: result.ok, cached: result.stats.cached }
    }, REQUEST)
    expect(again).toEqual({ ok: true, cached: 2 })

    const broken = await page.evaluate(async () => {
      const result = await window.bridge.wasmToolchainCompile({
        files: { 'x.c': 'int f( {' },
        units: [{ source: 'x.c', language: 'c' }],
      })
      return { ok: result.ok, messages: result.diagnostics.map((d) => d.message) }
    })
    expect(broken.ok).toBe(false)
    expect(broken.messages.some((m) => m.includes('x.c:1:'))).toBe(true)
  }

  test('shows the editor once clang is loaded and compiles through the bridge', async () => {
    const app = await launch('ready')
    try {
      await compilesThroughTheBridge(app)
    } finally {
      app.process().kill('SIGKILL')
    }
  })

  test('compiles in a packaged build', async () => {
    test.skip(PACKAGED_APP === '', 'Set E2E_PACKAGED_APP to a packaged build to run this case.')
    // Started from an empty directory, so only the packaged resources can provide clang.
    const cwd = join(ROOT, 'packaged', 'cwd')
    rmSync(join(ROOT, 'packaged'), { recursive: true, force: true })
    mkdirSync(cwd, { recursive: true })
    const app = await launch('packaged-run', cwd, PACKAGED_APP)
    try {
      await compilesThroughTheBridge(app)
    } finally {
      app.process().kill('SIGKILL')
    }
  })

  test('keeps the splash up with the reason when clang cannot load, and Quit closes the app', async () => {
    // Started from an empty directory, the editor finds no toolchain next to it.
    const cwd = join(ROOT, 'missing', 'cwd')
    rmSync(join(ROOT, 'missing'), { recursive: true, force: true })
    mkdirSync(cwd, { recursive: true })
    const app = await launch('missing-run', cwd)
    const proc = app.process()
    try {
      const splash = await windowByUrl(app, 'error=')
      await expect(splash.getByText('OpenPLC Editor could not start')).toBeVisible()
      await expect(splash.getByText(/The WebAssembly compiler could not be loaded/)).toBeVisible()
      expect(await mainWindowShown(app)).toBe(false)

      const exited = new Promise<number | null>((resolve) => proc.once('exit', (code) => resolve(code)))
      await splash.getByRole('button', { name: 'Quit' }).click()
      expect(await exited).toBe(0)
    } finally {
      if (proc.exitCode === null) proc.kill('SIGKILL')
    }
  })
})
