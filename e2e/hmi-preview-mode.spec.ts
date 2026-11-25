/**
 * Preview mode and drop marks in the built app: a button switches screens and a slider no variable is bound to keeps
 * the value it is dragged to, with no PLC; dragging a widget over a stack marks the stack and where the widget goes.
 *
 * Running it needs a production build plus the preload at the path a NON-packaged app looks for it; see "Electron
 * e2e" in CLAUDE.md.
 */
import { join } from 'node:path'

import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

import {
  accentOnStrip,
  hmiFixture,
  htmlDragOver,
  launchHmiApp,
  leaf,
  pickLayer,
  status,
  waitFor as waitForIn,
  writeHmiFixture,
} from './helpers/hmi-app'

const F = hmiFixture('hmi-preview-mode')

const OVERVIEW = `FUNCTION_BLOCK Overview EXTENDS HmiScreen
  VAR
    Col : HmiHorizontalStack := (Gap := 12, Padding := 16);
    Speed : HmiSlider := (Parent := 'Col', Caption := 'Speed', Value := 20.0);
    Next : HmiButton := (Parent := 'Col', Text := 'Next');
    Box : HmiVerticalStack := (Parent := 'Col', PrefHeight := 120, AutoSize := FALSE);
    Area : HmiDiagram := (Parent := 'Box', AutoSize := TRUE);
    Tank1 : HmiTank := (Parent := 'Area', X := 20, Y := 10);
  END_VAR
END_FUNCTION_BLOCK
`
const DETAILS = `FUNCTION_BLOCK Details EXTENDS HmiScreen
  VAR
    Body : HmiHorizontalStack;
    Back : HmiButton := (Text := 'Back', Parent := 'Body');
  END_VAR
  IF Back.Clicked THEN HMI_Back(); END_IF;
END_FUNCTION_BLOCK
`

const waitFor = (page: Page, what: string, check: () => Promise<boolean>, timeoutMs?: number) =>
  waitForIn(F, page, what, check, timeoutMs)
const pageShown = async (page: Page) =>
  page.locator('[data-testid="hmi-canvas-area"]:visible').first().getAttribute('data-page')

test.describe('HMI preview mode', () => {
  test.setTimeout(180000)

  test('operates the screen without a PLC, and marks where a dragged widget goes', async () => {
    writeHmiFixture(F, {
      main: 'PROGRAM Main\n  VAR\n    Run : BOOL;\n  END_VAR\n  Run := Run;\nEND_PROGRAM\n',
      screens: { Overview: OVERVIEW, Details: DETAILS },
      startScreen: 'Overview',
    })
    const { app, page } = await launchHmiApp(F)
    try {
      await page.getByText(F.name, { exact: true }).first().click({ timeout: 30000 })
      await waitFor(page, 'the HMI branch', async () => (await leaf(page, 'Overview').count()) > 0)
      await leaf(page, 'Overview').click()
      await waitFor(page, 'the preview', async () => (await status(page)).startsWith('ready'), 60000)

      await pickLayer(page, 'Col')
      const col = await page.getByTestId('hmi-selected-Col').boundingBox()
      const overlay = await page.getByTestId('hmi-canvas-overlay').boundingBox()
      if (!col || !overlay) throw new Error('the column is not on the canvas')
      await page.getByTestId('hmi-palette-tab-widgets').click()
      await htmlDragOver(page, 'hmi-palette-HmiLamp', col.x - overlay.x + 40, col.y - overlay.y + col.height - 20)
      await expect(page.getByTestId('hmi-drop-target')).toContainText('Add to Col')
      await expect(page.getByTestId('hmi-drop-line')).toBeVisible()
      await page.screenshot({ path: join(F.shots, 'drop-marks.png') })
      await page.getByTestId('hmi-canvas-overlay').dispatchEvent('dragleave')

      await pickLayer(page, 'Next')
      await page.getByTestId('hmi-prop-tab-actions').click()
      await page.getByTestId('hmi-action-Clicked').click()
      await page.getByRole('option', { name: 'Show a screen', exact: true }).click()
      await page.getByTestId('hmi-action-screen-Clicked').click()
      await page.getByRole('option', { name: 'Details', exact: true }).click()
      await waitFor(page, 'the rebuilt preview', async () => (await status(page)).startsWith('ready'), 60000)
      await page.screenshot({ path: join(F.shots, 'actions.png') })

      await pickLayer(page, 'Speed')
      await page.getByTestId('hmi-prop-tab-layout').click()
      const body = page.getByTestId('hmi-properties-body')
      const bodyBox = await body.boundingBox()
      const footer = await page.getByTestId('hmi-delete-element').boundingBox()
      if (!bodyBox || !footer) throw new Error('the properties card is not shown')
      expect(bodyBox.y + bodyBox.height).toBeLessThanOrEqual(footer.y)
      await body.evaluate((e) => e.scrollTo(0, e.scrollHeight))
      await page.screenshot({ path: join(F.shots, 'layout-scrolled.png') })
      await pickLayer(page, 'Next')

      await page.getByTestId('hmi-show-in-code').click()
      await expect(page.getByTestId('hmi-code-editor')).toBeVisible()
      await page.getByRole('button', { name: 'Designer' }).click()
      const button = await page.getByTestId('hmi-selected-Next').boundingBox()
      if (!button) throw new Error('the button is not on the canvas')
      await waitFor(page, 'the screen drawn again after the code view', async () =>
        accentOnStrip(page, button.x + button.width / 2, button.y, button.y + button.height),
      )

      await pickLayer(page, 'Speed')
      const slider = await page.getByTestId('hmi-selected-Speed').boundingBox()
      await pickLayer(page, 'Next')
      const next = await page.getByTestId('hmi-selected-Next').boundingBox()
      if (!slider || !next) throw new Error('the controls are not on the canvas')
      await page.getByTestId('hmi-preview-mode').click()
      await waitFor(page, 'the preview in preview mode', async () => (await status(page)).startsWith('ready'), 60000)
      await page.waitForTimeout(400)

      const y = slider.y + slider.height * 0.75
      const probe = slider.x + slider.width * 0.7
      expect(await accentOnStrip(page, probe, slider.y, slider.y + slider.height)).toBe(false)
      await page.mouse.move(slider.x + slider.width * 0.2, y)
      await page.mouse.down()
      await page.mouse.move(slider.x + slider.width * 0.9, y, { steps: 8 })
      await page.mouse.up()
      await page.waitForTimeout(600)
      await page.screenshot({ path: join(F.shots, 'slider-kept.png') })
      expect(await accentOnStrip(page, probe, slider.y, slider.y + slider.height)).toBe(true)
      await page.waitForTimeout(600)
      expect(await accentOnStrip(page, probe, slider.y, slider.y + slider.height)).toBe(true)

      const overviewPage = await pageShown(page)
      let detailsPage: string | null = null
      await page.mouse.click(next.x + next.width / 2, next.y + next.height / 2)
      await waitFor(page, 'the Details screen', async () => {
        detailsPage = await pageShown(page)
        return detailsPage !== null && detailsPage !== overviewPage
      })
      await page.getByTestId('hmi-preview-mode').click()

      await leaf(page, 'Details').click()
      await waitFor(page, 'the Details designer', async () => (await status(page)).startsWith('ready'), 60000)
      await waitFor(page, 'the Details screen in its own designer', async () => (await pageShown(page)) === detailsPage)
    } finally {
      app.process().kill('SIGKILL')
    }
  })
})
