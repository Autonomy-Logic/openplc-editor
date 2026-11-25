/**
 * A drop-down in the built app's preview mode: its list opens over the screen, a pick reaches the screen's code, and
 * the press on the list does not reach the check box drawn under it.
 *
 * Running it needs a production build plus the preload at the path a NON-packaged app looks for it; see "Electron
 * e2e" in CLAUDE.md.
 */
import { join } from 'node:path'

import type { Page } from '@playwright/test'
import { test } from '@playwright/test'

import {
  accentOnStrip,
  hmiFixture,
  launchHmiApp,
  leaf,
  pickLayer,
  status,
  waitFor as waitForIn,
  writeHmiFixture,
} from './helpers/hmi-app'

const F = hmiFixture('hmi-controls')

const PANEL = `FUNCTION_BLOCK Panel EXTENDS HmiScreen
  VAR
    Col : HmiHorizontalStack := (Gap := 12, Padding := 16);
    Row : HmiVerticalStack := (Parent := 'Col', Gap := 16, AutoSize := FALSE);
    Pick : HmiDropDown := (Parent := 'Row', Caption := 'Recipe', Options := 'Soup;Broth;Sauce;Cream', Value := 3);
    Marker : HmiRect := (Parent := 'Row', PrefWidth := 60, PrefHeight := 40);
    Under : HmiCheckBox := (Parent := 'Col', Caption := 'Under the list');
  END_VAR
  Marker.Fill := SEL(Pick.Value = 0, COLOR.Fill, COLOR.Accent);
END_FUNCTION_BLOCK
`

const waitFor = (page: Page, what: string, check: () => Promise<boolean>, timeoutMs?: number) =>
  waitForIn(F, page, what, check, timeoutMs)

/** The selected element's box on the page. */
async function boxOf(page: Page, name: string) {
  await pickLayer(page, name)
  const box = await page.getByTestId(`hmi-selected-${name}`).boundingBox()
  if (!box) throw new Error(`${name} is not on the canvas`)
  return box
}

test.describe('HMI controls', () => {
  test.setTimeout(180000)

  test('picks from a drop-down list drawn over the screen, without pressing what lies under it', async () => {
    writeHmiFixture(F, {
      main: 'PROGRAM Main\n  VAR\n    Run : BOOL;\n  END_VAR\n  Run := Run;\nEND_PROGRAM\n',
      screens: { Panel: PANEL },
      startScreen: 'Panel',
    })
    const { app, page } = await launchHmiApp(F)
    try {
      await page.getByText(F.name, { exact: true }).first().click({ timeout: 30000 })
      await waitFor(page, 'the HMI branch', async () => (await leaf(page, 'Panel').count()) > 0)
      await leaf(page, 'Panel').click()
      await waitFor(page, 'the preview', async () => (await status(page)).startsWith('ready'), 60000)

      const pick = await boxOf(page, 'Pick')
      const marker = await boxOf(page, 'Marker')
      const under = await boxOf(page, 'Under')
      const lu = pick.height / 60
      const markerOn = () => accentOnStrip(page, marker.x + marker.width / 2, marker.y, marker.y + marker.height)
      const underOn = () => accentOnStrip(page, under.x + 12 * lu, under.y, under.y + under.height)

      await page.getByTestId('hmi-preview-mode').click()
      await waitFor(page, 'the preview in preview mode', async () => (await status(page)).startsWith('ready'), 60000)
      await waitFor(page, 'the marker off for Cream', async () => !(await markerOn()))

      await page.mouse.click(pick.x + pick.width / 2, pick.y + pick.height / 2)
      await page.waitForTimeout(400)
      await page.screenshot({ path: join(F.shots, 'list-open.png') })
      /* The list's first row, Soup, lies 4 + 4 + 16 lu under the field, over the check box. */
      const rowY = pick.y + pick.height + 24 * lu
      if (rowY < under.y || rowY > under.y + under.height) throw new Error('the first row is not over the check box')
      await page.mouse.click(pick.x + 40 * lu, rowY)
      await waitFor(page, 'the marker on for Soup', markerOn)
      await page.screenshot({ path: join(F.shots, 'picked.png') })
      if (await underOn()) throw new Error('the press on the list reached the check box')
    } finally {
      app.process().kill('SIGKILL')
    }
  })
})
