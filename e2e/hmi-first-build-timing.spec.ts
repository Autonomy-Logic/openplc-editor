/**
 * Timing run of the HMI preview's first build, three sessions on one profile: a fresh profile (Overview, then Layout in
 * the same session), then two restarts (Overview). Each session appends one JSON line to `FB_OUT` with the time from a
 * screen's click to its first frame. A local measurement, not a CI check:
 *
 *   FB_RUN=1 FB_OUT=/path/results.jsonl npx playwright test e2e/hmi-first-build-timing.spec.ts --workers=1
 *
 * Needs a production build (which builds the shipped HMI objects) and the preload copy; see "Electron e2e" in
 * CLAUDE.md.
 */
import { appendFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

import { hmiFixture, launchHmiApp, leaf, status, waitFor, writeHmiFixture } from './helpers/hmi-app'

const LAYOUT = `FUNCTION_BLOCK Layout EXTENDS HmiScreen
  VAR
    Col : HmiHorizontalStack := (Gap := 8, Padding := 8);
    Top : HmiVerticalStack := (Parent := 'Col', Gap := 12, GrowAuto := FALSE);
    A : HmiLabel := (Text := 'Alpha', Parent := 'Top');
    B : HmiLabel := (Text := 'Bravo', Parent := 'Top');
    C : HmiLabel := (Text := 'Charlie', Parent := 'Top');
    Bottom : HmiVerticalStack := (Parent := 'Col', Gap := 12, GrowAuto := FALSE);
    D : HmiLabel := (Text := 'Delta', Parent := 'Bottom');
    Plant : HmiDiagram := (Parent := 'Col', DesignW := 400, DesignH := 120);
    Tank : HmiTank := (Parent := 'Plant', X := 20, Y := 10, Caption := 'T1');
  END_VAR
END_FUNCTION_BLOCK
`
const OVERVIEW = `FUNCTION_BLOCK Overview EXTENDS HmiScreen
  VAR
    Col : HmiHorizontalStack := (Gap := 8, Padding := 8);
    Title : HmiLabel := (Text := 'Overview', Parent := 'Col');
    Plant : HmiDiagram := (Parent := 'Col', DesignW := 400, DesignH := 160);
    Tank : HmiTank := (Parent := 'Plant', X := 20, Y := 10, Caption := 'T1');
  END_VAR
END_FUNCTION_BLOCK
`
const MAIN = 'PROGRAM Main\n  VAR\n    Level : REAL := 6.5;\n  END_VAR\n  Level := Level;\nEND_PROGRAM\n'
const RUN = process.env.FB_RUN ?? '0'
const OUT = process.env.FB_OUT ?? join(__dirname, '..', 'first-build-timing.jsonl')
const F = hmiFixture(`hmi-first-build-${RUN}`)

const wasmObjects = (): number => {
  const dir = join(F.userData, 'User', 'WasmObjects')
  return existsSync(dir) ? readdirSync(dir).length : 0
}

/** Clicks a screen and returns the ms until its preview shows its first frame. */
async function openScreen(page: Page, name: string): Promise<number> {
  const started = Date.now()
  await leaf(page, name).click()
  await expect(page.getByTestId('hmi-designer').first()).toBeVisible({ timeout: 15000 })
  await waitFor(
    F,
    page,
    `${name}'s preview`,
    async () => {
      const now = await status(page)
      if (now.startsWith('failed') || now.startsWith('stopped'))
        throw new Error(`the preview ${now}: ${(await page.getByTestId('hmi-errors').allInnerTexts()).join(' | ')}`)
      return now.startsWith('ready')
    },
    170000,
  )
  return Date.now() - started
}

/** Waits until no stored object was added for six seconds: the palette's gallery and every write have finished. */
async function storeSettled(page: Page): Promise<void> {
  let last = -1
  let still = 0
  for (let i = 0; i < 90 && still < 3; i++) {
    const now = wasmObjects()
    still = now === last ? still + 1 : 0
    last = now
    await page.waitForTimeout(2000)
  }
}

async function session(label: string, screens: string[], fresh: boolean): Promise<void> {
  if (fresh)
    writeHmiFixture(F, { main: MAIN, screens: { Overview: OVERVIEW, Layout: LAYOUT }, startScreen: 'Overview' })
  const launched = Date.now()
  const { app, page } = await launchHmiApp(F)
  try {
    const windowMs = Date.now() - launched
    await page.getByText(F.name, { exact: true }).first().click({ timeout: 30000 })
    await waitFor(F, page, 'the HMI branch', async () => (await leaf(page, screens[0]).count()) > 0)
    const projectMs = Date.now() - launched
    const opened: Array<{ screen: string; ms: number }> = []
    for (const screen of screens) {
      const ms = await openScreen(page, screen)
      opened.push({ screen, ms })
    }
    await storeSettled(page)
    const load = (await import('node:os')).loadavg()[0]
    appendFileSync(
      OUT,
      `${JSON.stringify({ run: RUN, label, windowMs, projectMs, opened, load, stored: wasmObjects() })}\n`,
    )
  } finally {
    app.process().kill('SIGKILL')
  }
}

test.describe.serial('HMI preview first build timing', () => {
  test.skip(process.env.FB_RUN === undefined, 'a local measurement: set FB_RUN to run it')
  test.setTimeout(420000)

  test('fresh profile, then a second screen in the same session', async () => {
    await session('fresh', ['Overview', 'Layout'], true)
  })

  test('restart on the same profile', async () => {
    await session('restart', ['Overview'], false)
  })

  test('restart on the same profile again', async () => {
    await session('restart2', ['Overview'], false)
  })
})
