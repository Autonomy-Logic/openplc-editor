/**
 * Libraries in the built app: the pre-installed HMI libraries come from the pinned openplc-hmi-widgets release; the
 * widgets of a library a user installed show in the HMI palette and build in the preview, while the PLC library tree
 * lists only POUs a PLC build can use (HMI Alarms, plain functions) and never a widget; a library built for another
 * HMI core API is left out of HMI builds with its reason.
 *
 * Running it needs `npm run setup:hmi-widgets`, a production build and the preload at the path a NON-packaged app looks
 * for it; see "Electron e2e" in CLAUDE.md.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Page } from '@playwright/test'
import { test } from '@playwright/test'

import { HMI_CORE_API_VERSION } from '../src/middleware/shared/utils/hmi/widget-libraries'
import { hmiFixture, launchHmiApp, leaf, status, waitFor as waitForIn, writeHmiFixture } from './helpers/hmi-app'

const ROOT = join(__dirname, '..')

const MAIN = `PROGRAM Main
  VAR
    Level : INT := 40;
    Alarms : ARRAY[1..4] OF HMI_ALARM_ROW;
  END_VAR
END_PROGRAM
`

const PANEL = `FUNCTION_BLOCK Panel EXTENDS HmiScreen
  VAR
    Col : HmiHorizontalStack := (Gap := 12, Padding := 16);
    Dial : HmiDial := (Parent := 'Col', PrefHeight := 80, GrowAuto := FALSE);
  END_VAR
  Dial.Value := instance0.Main.Level > 10;
END_FUNCTION_BLOCK
`

let F = hmiFixture('hmi-widget-libraries')

const waitFor = (page: Page, what: string, check: () => Promise<boolean>, timeoutMs?: number) =>
  waitForIn(F, page, what, check, timeoutMs)

/** Installs the e2e widget library into the fixture's user libraries, as the library manager stores it. */
function installExtraWidgets(coreApi: number): void {
  const librariesDir = join(F.userData, 'libraries')
  const dir = join(librariesDir, 'extra-widgets')
  mkdirSync(dir, { recursive: true })
  const stlibPath = join(dir, 'extra-widgets.stlib')
  execFileSync(
    'npx',
    [
      'ts-node',
      '-T',
      '-r',
      'tsconfig-paths/register',
      join('e2e', 'fixtures', 'hmi-widget-library', 'make-library.ts'),
      stlibPath,
      String(coreApi),
    ],
    { cwd: ROOT, stdio: 'pipe' },
  )
  writeFileSync(
    join(librariesDir, 'registry.json'),
    JSON.stringify({
      formatVersion: '1.0',
      libraries: {
        'extra-widgets': { version: '1.0.0', installedAt: new Date().toISOString(), stlibPath, origin: 'stlib' },
      },
    }),
  )
}

/** The preview's state: true when ready; fails at once with the designer's errors when its build failed. */
async function previewReady(page: Page): Promise<boolean> {
  const state = await status(page)
  if (state.startsWith('failed'))
    throw new Error(`the preview failed: ${(await page.getByTestId('hmi-errors').allInnerTexts()).join(' | ')}`)
  return state.startsWith('ready')
}

async function openPanel(page: Page): Promise<void> {
  await page.getByText(F.name, { exact: true }).first().click({ timeout: 30000 })
  await waitFor(page, 'the HMI branch', async () => (await leaf(page, 'Panel').count()) > 0)
  await leaf(page, 'Panel').click()
}

test.describe('HMI widget libraries', () => {
  test.setTimeout(180000)

  test("shows an installed library's widgets in the palette and builds with them, never in the PLC library tree", async () => {
    F = hmiFixture('hmi-widget-libraries')
    writeHmiFixture(F, { main: MAIN, screens: { Panel: PANEL }, startScreen: 'Panel' })
    installExtraWidgets(HMI_CORE_API_VERSION)
    const { app, page } = await launchHmiApp(F)
    try {
      await openPanel(page)
      await waitFor(page, 'the preview with the installed widget', () => previewReady(page), 90000)
      await page.getByTestId('hmi-palette-tab-widgets').click()
      await waitFor(page, 'the installed and the standard widgets in the palette', async () => {
        const dial = await page.getByTestId('hmi-palette-HmiDial').isVisible()
        const button = await page.getByTestId('hmi-palette-HmiButton').isVisible()
        return dial && button
      })
      await page.screenshot({ path: join(F.shots, 'palette.png') })
      const tree = page.locator('#library-tree-container')
      await waitFor(page, 'HMI Alarms in the PLC library tree', async () =>
        (await tree.innerText()).includes('HMI Alarms'),
      )
      const text = await tree.innerText()
      for (const widget of ['HmiDial', 'HMIDIAL', 'HmiButton', 'HMIBUTTON', 'HmiElement', 'HMIELEMENT'])
        if (text.includes(widget)) throw new Error(`the PLC library tree lists the widget ${widget}`)
      await page.screenshot({ path: join(F.shots, 'library-tree.png') })
    } finally {
      app.process().kill('SIGKILL')
    }
  })

  test('leaves out a library built for another HMI core API, naming it and both versions', async () => {
    F = hmiFixture('hmi-widget-libraries-old-core')
    writeHmiFixture(F, { main: MAIN, screens: { Panel: PANEL }, startScreen: 'Panel' })
    installExtraWidgets(HMI_CORE_API_VERSION + 1)
    const { app, page } = await launchHmiApp(F)
    try {
      await openPanel(page)
      const reason =
        `the library "extra-widgets" declares it but is left out of HMI builds: it is built for HMI core API ` +
        `${HMI_CORE_API_VERSION + 1}, but this editor provides HMI core API ${HMI_CORE_API_VERSION}`
      await waitFor(page, 'the reason in the designer', async () => {
        const errors = (await page.getByTestId('hmi-errors').allInnerTexts()).join(' | ')
        return errors.includes(reason)
      })
      await page.screenshot({ path: join(F.shots, 'refused.png') })
      if ((await page.getByTestId('hmi-palette-HmiDial').count()) > 0)
        throw new Error('the palette offers a widget of the refused library')
    } finally {
      app.process().kill('SIGKILL')
    }
  })
})
