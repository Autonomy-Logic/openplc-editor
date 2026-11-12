/**
 * The test-only debug seam opens a debug session without a PLC.
 *
 * Needs a build made with OPENPLC_E2E_DEBUG_SEAM=1; `npm run test:e2e` sets it.
 */
import { join } from 'node:path'

import type { ElectronApplication, Page } from '@playwright/test'
import { _electron as electron, expect, test } from '@playwright/test'

type DebugSessionSeam = { open(): void; close(): void; isOpen(): boolean }

declare global {
  interface Window {
    __OPENPLC_E2E_DEBUG_SESSION__?: DebugSessionSeam
  }
}

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [join(__dirname, '..', 'release', 'app', 'dist', 'main', 'main.js')],
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
        /* window is closing; skip it */
      }
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('main window never appeared')
}

test.describe('debug session seam', () => {
  test('opens and closes a debug session with no PLC attached', async () => {
    const { app, page } = await launch()
    try {
      await expect.poll(() => page.evaluate(() => typeof window.__OPENPLC_E2E_DEBUG_SESSION__)).toBe('object')

      const opened = await page.evaluate(() => {
        window.__OPENPLC_E2E_DEBUG_SESSION__?.open()
        return window.__OPENPLC_E2E_DEBUG_SESSION__?.isOpen()
      })
      expect(opened).toBe(true)

      const closed = await page.evaluate(() => {
        window.__OPENPLC_E2E_DEBUG_SESSION__?.close()
        return window.__OPENPLC_E2E_DEBUG_SESSION__?.isOpen()
      })
      expect(closed).toBe(false)
    } finally {
      await app.close()
    }
  })
})
