/**
 * Animated widgets and shapes in the built app: the palette offers the ellipse, polygon, line, fan and conveyor, and on
 * the running preview a fan that is on turns while one that is off stays still.
 *
 * Running it needs a production build plus the preload at the path a NON-packaged app looks for it; see "Electron
 * e2e" in CLAUDE.md.
 */
import { join } from 'node:path'

import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

import {
  hmiFixture,
  launchHmiApp,
  leaf,
  pickLayer,
  status,
  waitFor as waitForIn,
  writeHmiFixture,
} from './helpers/hmi-app'

const F = hmiFixture('hmi-animation')

const PLANT = `FUNCTION_BLOCK Plant EXTENDS HmiScreen
  VAR
    Row : HmiStack := (Direction := HMI_DIRECTION#Row, Gap := 24, Padding := 24, GrowAuto := FALSE);
    Spinning : HmiFan := (Parent := 'Row', Caption := 'On', Value := TRUE, PrefWidth := 96, PrefHeight := 111);
    Still : HmiFan := (Parent := 'Row', Caption := 'Off', PrefWidth := 96, PrefHeight := 111);
    Star : HmiPolygon := (Parent := 'Row', Sides := 5, InnerPct := 45, Fill := COLOR.Warning);
  END_VAR
END_FUNCTION_BLOCK
`

const waitFor = (page: Page, what: string, check: () => Promise<boolean>, timeoutMs?: number) =>
  waitForIn(F, page, what, check, timeoutMs)

/** The preview's pixels inside an element's outline, as one string. */
async function pixelsOf(page: Page, testId: string): Promise<string> {
  const box = await page.getByTestId(testId).boundingBox()
  if (!box) throw new Error(`${testId} is not on the canvas`)
  return page.evaluate((b) => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="hmi-canvas"] canvas')
    const context = canvas?.getContext('2d')
    if (!canvas || !context) throw new Error('no preview canvas')
    const rect = canvas.getBoundingClientRect()
    const sx = canvas.width / rect.width
    const sy = canvas.height / rect.height
    const data = context.getImageData(
      Math.round((b.x - rect.left) * sx),
      Math.round((b.y - rect.top) * sy),
      Math.max(1, Math.round(b.width * sx)),
      Math.max(1, Math.round(b.height * sy)),
    ).data
    return Array.from(data).join(',')
  }, box)
}

test.describe('HMI animation', () => {
  test.setTimeout(180000)

  test('offers the new shapes and animated widgets, and turns a fan only while it is on', async () => {
    writeHmiFixture(F, {
      main: 'PROGRAM Main\n  VAR\n    Run : BOOL;\n  END_VAR\n  Run := Run;\nEND_PROGRAM\n',
      screens: { Plant: PLANT },
      startScreen: 'Plant',
    })
    const { app, page } = await launchHmiApp(F)
    try {
      await page.getByText(F.name, { exact: true }).first().click({ timeout: 30000 })
      await waitFor(page, 'the HMI branch', async () => (await leaf(page, 'Plant').count()) > 0)
      await leaf(page, 'Plant').click()
      await waitFor(page, 'the preview', async () => (await status(page)).startsWith('ready'), 60000)

      for (const widget of ['HmiEllipse', 'HmiPolygon', 'HmiLine', 'HmiFan', 'HmiConveyor'])
        await expect(page.getByTestId(`hmi-palette-${widget}`)).toHaveCount(1)

      await pickLayer(page, 'Spinning')
      const turning = await pixelsOf(page, 'hmi-selected-Spinning')
      await waitFor(
        page,
        'the fan that is on to turn',
        async () => (await pixelsOf(page, 'hmi-selected-Spinning')) !== turning,
      )
      await page.screenshot({ path: join(F.shots, 'animation.png') })

      await pickLayer(page, 'Still')
      const still = await pixelsOf(page, 'hmi-selected-Still')
      await page.waitForTimeout(600)
      expect(await pixelsOf(page, 'hmi-selected-Still')).toBe(still)
    } finally {
      app.process().kill('SIGKILL')
    }
  })
})
