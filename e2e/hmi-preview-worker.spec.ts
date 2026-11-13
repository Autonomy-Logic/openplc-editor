/**
 * The HMI preview's Worker in the built app: the renderer starts it from its own bundle, and it compiles and runs a
 * WebAssembly module under the page's Content Security Policy, answering the preview protocol.
 *
 * Running it needs a production build plus the preload at the path a NON-packaged app looks for it; see "Electron
 * e2e" in CLAUDE.md.
 */
import { mkdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ElectronApplication, Page } from '@playwright/test'
import { _electron as electron, expect, test } from '@playwright/test'

const USER_DATA = join(realpathSync(tmpdir()), 'openplc-e2e-hmi-preview-worker')
const FIXTURE = join(__dirname, '..', 'src', 'backend', 'shared', 'hmi', 'preview', '__tests__', 'fixtures')

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  rmSync(USER_DATA, { recursive: true, force: true })
  mkdirSync(USER_DATA, { recursive: true })
  const app = await electron.launch({
    args: [join(__dirname, '..', 'release', 'app', 'dist', 'main', 'main.js'), `--user-data-dir=${USER_DATA}`],
    env: { ...process.env, NODE_ENV: 'production' },
  })
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    for (const w of app.windows()) {
      try {
        if (w.url().includes('index.html')) {
          await w.waitForLoadState('domcontentloaded')
          return { app, page: w }
        }
      } catch {
        /* window is closing */
      }
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('main window never appeared')
}

test.describe('HMI preview worker', () => {
  test.setTimeout(120000)

  test('runs a preview module in its Worker under the page CSP', async () => {
    const wasm = Array.from(readFileSync(join(FIXTURE, 'fake-preview-host.wasm')))
    const { app, page } = await launch()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    try {
      const replies = await page.evaluate(async (bytes) => {
        const worker = new Worker(new URL('hmi-preview-worker.js', window.location.href), { name: 'hmi-preview' })
        const answers: unknown[] = []
        const next = () =>
          new Promise<unknown>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('the preview worker did not answer')), 15000)
            worker.onmessage = (event: MessageEvent<unknown>) => {
              clearTimeout(timer)
              resolve(event.data)
            }
            worker.onerror = (event) => {
              clearTimeout(timer)
              reject(new Error(event.message || 'the preview worker failed'))
            }
          })
        const wasmBytes = new Uint8Array(bytes)
        worker.postMessage({ id: 1, type: 'load', wasm: wasmBytes, width: 16, height: 8, page: 3, design: false })
        answers.push(await next())
        worker.postMessage({ id: 2, type: 'frame', timeMs: 0, surface: { width: 16, height: 8, scale: 1 } })
        const frame = await next()
        answers.push(frame)
        worker.terminate()
        return answers.map((a) => JSON.stringify(a, (_k, v: unknown) => (ArrayBuffer.isView(v) ? v.byteLength : v)))
      }, wasm)
      expect(JSON.parse(replies[0])).toEqual({ id: 1, ok: true })
      const frame = JSON.parse(replies[1])
      expect(frame).toMatchObject({
        id: 2,
        ok: true,
        frame: { page: 3, status: 0, pixels: { y0: 0, rows: 8, rgba: 512 } },
      })
      expect(frame.frame.bounds).toHaveLength(2)
      expect(errors).toEqual([])
    } finally {
      app.process().kill('SIGKILL')
    }
  })
})
