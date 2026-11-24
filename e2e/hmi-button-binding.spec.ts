/**
 * A push button wired to a variable in the built app: the screen shows a loading panel until its first build runs, the
 * variable list offers BOOL variables only, and the variable follows the button TRUE or FALSE while pressed, as the
 * Behavior dropdown says; a lamp wired to the same variable shows it, with no PLC. A click on the selected element
 * clears the selection.
 *
 * Running it needs a production build plus the preload at the path a NON-packaged app looks for it; see "Electron
 * e2e" in CLAUDE.md.
 */
import { join } from 'node:path'

import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

import {
  centre,
  hmiFixture,
  launchHmiApp,
  leaf,
  pickLayer,
  previewBuilds,
  save,
  screenOnDisk,
  status,
  waitFor as waitForIn,
  writeHmiFixture,
} from './helpers/hmi-app'

const F = hmiFixture('hmi-button-binding')

const OVERVIEW = `FUNCTION_BLOCK Overview EXTENDS HmiScreen
  VAR
    Row : HmiVerticalStack := (Gap := 24, Padding := 24, AutoSize := FALSE);
    Jog : HmiButton := (Parent := 'Row', Text := 'Jog', PrefWidth := 160);
    Light : HmiLamp := (Parent := 'Row', Caption := 'Run');
  END_VAR
  Light.Value := instance0.Main.Run;
END_FUNCTION_BLOCK
`

const waitFor = (page: Page, what: string, check: () => Promise<boolean>, timeoutMs?: number) =>
  waitForIn(F, page, what, check, timeoutMs)

/** The preview's color at a page point, as #RRGGBB. */
async function colorAt(page: Page, at: { x: number; y: number }): Promise<string> {
  return page.evaluate(({ x, y }) => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="hmi-canvas"] canvas')
    const context = canvas?.getContext('2d')
    if (!canvas || !context) throw new Error('no preview canvas')
    const rect = canvas.getBoundingClientRect()
    const px = Math.round(((x - rect.left) * canvas.width) / rect.width)
    const py = Math.round(((y - rect.top) * canvas.height) / rect.height)
    const [r, g, b] = context.getImageData(px, py, 1, 1).data
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase()
  }, at)
}

/** Whether a preview build finished after `before` builds and the preview is ready. */
const rebuilt = async (page: Page, before: number): Promise<boolean> =>
  (await previewBuilds(page)) > before && (await status(page)).startsWith('ready')

/** Picks an option of one of the designer's selects. */
async function choose(page: Page, testId: string, option: string): Promise<void> {
  await page.getByTestId(testId).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

test.describe('HMI button binding', () => {
  test.setTimeout(180000)

  test('shows build progress, offers BOOL variables only, and sets the variable while pressed', async () => {
    writeHmiFixture(F, {
      main: 'PROGRAM Main\n  VAR\n    Run : BOOL;\n    Level : REAL;\n  END_VAR\n  Run := Run;\nEND_PROGRAM\n',
      screens: { Overview: OVERVIEW },
      startScreen: 'Overview',
    })
    const { app, page } = await launchHmiApp(F)
    try {
      await page.getByText(F.name, { exact: true }).first().click({ timeout: 30000 })
      await waitFor(page, 'the HMI branch', async () => (await leaf(page, 'Overview').count()) > 0)
      await leaf(page, 'Overview').click()
      const loading = page.getByTestId('hmi-preview-loading')
      await expect(loading).toBeVisible({ timeout: 10000 })
      await expect(loading).toContainText('Building the preview')
      await page.screenshot({ path: join(F.shots, 'loading.png') })
      await waitFor(page, 'the preview', async () => (await status(page)).startsWith('ready'), 60000)
      await expect(loading).toBeHidden()

      await pickLayer(page, 'Light')
      const light = await page.getByTestId('hmi-selected-Light').boundingBox()
      if (!light) throw new Error('the lamp is not on the canvas')
      const lamp = { x: light.x + light.height / 2, y: light.y + light.height / 2 }
      await pickLayer(page, 'Jog')
      const jog = await centre(page, 'hmi-selected-Jog')
      await page.mouse.click(jog.x, jog.y)
      await expect(page.getByTestId('hmi-selected-Jog')).toBeHidden()
      await page.mouse.click(jog.x, jog.y)
      await expect(page.getByTestId('hmi-selected-Jog')).toBeVisible()
      await page.getByTestId('hmi-prop-tab-data').click()
      let before = await previewBuilds(page)
      await page.getByTestId('hmi-main-binding').click()
      await expect(page.getByRole('option', { name: 'instance0.Main.Run : BOOL', exact: true })).toBeVisible()
      await expect(page.getByRole('option', { name: 'instance0.Main.Level : REAL', exact: true })).toHaveCount(0)
      await page.getByRole('option', { name: 'instance0.Main.Run : BOOL', exact: true }).click()
      await expect(page.getByTestId('hmi-main-press')).toContainText('Set to TRUE while pressed')
      await page.screenshot({ path: join(F.shots, 'binding.png') })
      await waitFor(page, 'the rebuilt preview', async () => rebuilt(page, before), 60000)

      before = await previewBuilds(page)
      await page.getByTestId('hmi-preview-mode').click()
      await waitFor(page, 'the preview in preview mode', async () => rebuilt(page, before), 60000)
      const screen = page.getByTestId('hmi-canvas')
      expect(await screen.evaluate((e) => getComputedStyle(e).boxShadow)).toContain('0px 0px 0px 3px')
      const off = await colorAt(page, lamp)
      await page.mouse.move(jog.x, jog.y)
      await page.mouse.down()
      await waitFor(page, 'the lamp on while Jog is held', async () => (await colorAt(page, lamp)) !== off, 60000)
      await page.screenshot({ path: join(F.shots, 'pressed.png') })
      await page.mouse.up()
      await waitFor(page, 'the lamp off once Jog is released', async () => (await colorAt(page, lamp)) === off)
      await page.getByTestId('hmi-preview-mode').click()

      await pickLayer(page, 'Jog')
      await page.getByTestId('hmi-prop-tab-data').click()
      before = await previewBuilds(page)
      await choose(page, 'hmi-main-press', 'Set to FALSE while pressed')
      await waitFor(page, 'the rebuilt preview', async () => rebuilt(page, before), 60000)
      await save(app)
      await waitFor(page, 'the binding on disk', async () => screenOnDisk(F, 'Overview').includes('NOT Jog.Pressed'))
      expect(screenOnDisk(F, 'Overview')).toMatch(
        /IF Jog\.Changed THEN\s+instance0\.Main\.Run := NOT Jog\.Pressed;\s+END_IF;/,
      )

      before = await previewBuilds(page)
      await page.getByTestId('hmi-preview-mode').click()
      await waitFor(page, 'the preview in preview mode', async () => rebuilt(page, before), 60000)
      await page.mouse.move(jog.x, jog.y)
      await page.mouse.down()
      await page.waitForTimeout(500)
      expect(await colorAt(page, lamp)).toBe(off)
      await page.mouse.up()
      await waitFor(page, 'the lamp on once Jog is released', async () => (await colorAt(page, lamp)) !== off, 60000)
    } finally {
      app.process().kill('SIGKILL')
    }
  })
})
