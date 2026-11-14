/**
 * The HMI designer in the built app: a screen opens in the designer with its preview drawn by the real core; widgets
 * are added from the palette, wired to PLC variables and edited in the inspector; code written in ST survives visual
 * edits (TC01); a widget block appears in the palette and wires like a library widget (TC02); renaming a used widget
 * block renames its uses or leaves them (TC26); undo covers both views.
 *
 * Running it needs a production build plus the preload at the path a NON-packaged app looks for it; see "Electron
 * e2e" in CLAUDE.md. Every wait also reads the app's own error text and fails at once when the app reports one.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

import {
  codeText,
  hmiFixture,
  htmlDrag,
  launchHmiApp,
  leaf,
  pickLayer,
  propertyField,
  save,
  screenOnDisk,
  status,
  undo,
  waitFor as waitForIn,
  writeHmiFixture,
} from './helpers/hmi-app'

const F = hmiFixture('hmi-designer')
const SHOTS = F.shots

const OVERVIEW = `FUNCTION_BLOCK Overview EXTENDS HmiScreen
  VAR
    (* keep this comment *)
    Col : HmiStack := (Direction := HMI_DIRECTION#Column, Gap := 8, Padding := 8);
    Title : HmiLabel := (Text := 'Overview', Parent := 'Col');
    Level : HmiTank := (Caption := 'Level', Parent := 'Col', MaxValue := 10.0);
  END_VAR
  Level.Value := Main.Level;
END_FUNCTION_BLOCK
`
const DETAILS = `FUNCTION_BLOCK Details EXTENDS HmiScreen
  VAR
    Back : HmiButton := (Text := 'Back');
  END_VAR
  IF Back.Clicked THEN HMI_Back(); END_IF;
END_FUNCTION_BLOCK
`
const BADGE = `FUNCTION_BLOCK Badge EXTENDS HmiSwitch
  METHOD PROTECTED OVERRIDE Draw : BOOL
    HMI_FillRect(Left, Top, Width, Height, 4, SEL(Value, COLOR.Border, COLOR.Danger));
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK
`

const MAIN =
  'PROGRAM Main\n  VAR\n    Level : REAL := 6.5;\n    Running : BOOL;\n  END_VAR\n  Level := Level;\nEND_PROGRAM\n'

const waitFor = (page: Page, what: string, check: () => Promise<boolean>, timeoutMs?: number) =>
  waitForIn(F, page, what, check, timeoutMs)
const overviewOnDisk = () => screenOnDisk(F, 'Overview')

test.describe('HMI designer', () => {
  test.setTimeout(180000)

  test('designs a screen visually and in ST, on the real preview', async () => {
    writeHmiFixture(F, {
      main: MAIN,
      globals: [{ name: 'Alarm', type: 'BOOL', initialValue: 'TRUE' }],
      screens: { Overview: OVERVIEW, Details: DETAILS },
      widgets: { Badge: BADGE },
      startScreen: 'Overview',
    })
    const { app, page } = await launchHmiApp(F)
    try {
      await page.getByText('hmi-designer', { exact: true }).first().click({ timeout: 30000 })
      await waitFor(page, 'the HMI branch', async () => (await leaf(page, 'Overview').count()) > 0)
      await leaf(page, 'Overview').click()
      await expect(page.getByTestId('hmi-designer')).toBeVisible({ timeout: 15000 })
      await waitFor(page, 'the preview', async () => (await status(page)).startsWith('ready'), 60000)
      await page.screenshot({ path: join(SHOTS, '01-opened.png') })
      expect(overviewOnDisk()).toBe(OVERVIEW)
      const builtMs = await status(page)
      const fitZoom = await page.getByTestId('hmi-zoom').innerText()

      await waitFor(
        page,
        'the palette thumbnails',
        async () =>
          (await page.locator('[data-testid="hmi-palette-HmiLamp"] img').count()) > 0 &&
          (await page.locator('[data-testid="hmi-palette-Badge"] img').count()) > 0,
        60000,
      )
      await page.getByTestId('hmi-palette').screenshot({ path: join(SHOTS, '00-palette.png') })

      await pickLayer(page, 'Title')
      const text = await propertyField(page, 'Text')
      await text.fill('Plant overview')
      await text.press('Enter')
      await page.waitForTimeout(400)
      expect(await status(page)).toBe(builtMs)

      const canvas = page.getByTestId('hmi-canvas-overlay')
      await pickLayer(page, 'Col')
      const colBox = await page.getByTestId('hmi-selected-Col').boundingBox()
      const canvasBox = await canvas.boundingBox()
      if (!colBox || !canvasBox) throw new Error('the column is not on the canvas')
      await page.getByTestId('hmi-palette-tab-widgets').click()
      await htmlDrag(
        page,
        'hmi-palette-HmiLamp',
        colBox.x - canvasBox.x + colBox.width / 2,
        colBox.y - canvasBox.y + colBox.height - 3,
      )
      await expect(page.getByTestId('hmi-selected-Lamp1')).toBeVisible({ timeout: 10000 })
      await waitFor(page, 'the rebuilt preview', async () => (await status(page)).startsWith('ready'))
      await pickLayer(page, 'Lamp1')
      await page.getByTestId('hmi-palette-tab-variables').click()
      const lampBox = await page.getByTestId('hmi-selected-Lamp1').boundingBox()
      const overlayBox = await canvas.boundingBox()
      if (!lampBox || !overlayBox) throw new Error('the lamp is not on the canvas')
      await htmlDrag(
        page,
        'hmi-variable-GVL.Alarm',
        lampBox.x - overlayBox.x + lampBox.width / 2,
        lampBox.y - overlayBox.y + lampBox.height / 2,
      )
      await expect(page.getByTestId('hmi-main-binding')).toContainText('GVL.Alarm', { timeout: 10000 })

      const handle = await page.getByTestId('hmi-grow-right').boundingBox()
      if (!handle) throw new Error('no grow handle')
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
      await page.mouse.down()
      await page.mouse.move(handle.x + 60, handle.y + handle.height / 2, { steps: 5 })
      await page.mouse.up()

      await page.getByRole('button', { name: 'Code', exact: true }).click()
      await waitFor(page, 'the code view', async () => (await codeText(page)).includes('FUNCTION_BLOCK Overview'))
      await page.locator('[data-testid="hmi-code-editor"] .view-lines:visible').click()
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home')
      for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Home')
      await page.keyboard.insertText('METHOD Extra : BOOL Extra := TRUE; END_METHOD ')
      await waitFor(page, 'the method in the code', async () =>
        (await codeText(page)).includes('END_VAR\n  METHOD Extra'),
      )
      await page.getByRole('button', { name: 'Designer' }).click()
      await expect(page.getByTestId('hmi-zoom')).toHaveText(fitZoom, { timeout: 5000 })
      await page.screenshot({ path: join(SHOTS, '03-back-from-code.png') })
      await pickLayer(page, 'Level')
      const max = await propertyField(page, 'MaxValue')
      await max.fill('20.0')
      await max.press('Enter')

      await pickLayer(page, 'Col')
      await page.getByTestId('hmi-palette-tab-widgets').click()
      await page.getByTestId('hmi-palette-Badge').dblclick()
      await expect(page.getByTestId('hmi-selected-Badge1')).toBeVisible({ timeout: 10000 })
      await page.getByTestId('hmi-prop-tab-data').click()
      await page.getByTestId('hmi-main-binding').click()
      await page.getByRole('option', { name: /Main\.Running/ }).click()
      await waitFor(
        page,
        'the preview with the widget block',
        async () => (await status(page)).startsWith('ready'),
        60000,
      )
      await page.screenshot({ path: join(SHOTS, '02-designed.png') })

      const notice = page.getByTestId('hmi-preview-notice')
      await page.getByTestId('hmi-preview-mode').click()
      await expect(notice).toHaveAttribute('data-visible', 'true')
      await page.screenshot({ path: join(SHOTS, '04-preview-mode.png') })
      await expect(page.getByTestId('hmi-inspector')).toHaveCount(0)
      await expect(notice).toHaveAttribute('data-visible', 'false', { timeout: 6000 })
      await page.getByTestId('hmi-palette-tab-variables').click()
      await expect(notice).toHaveAttribute('data-visible', 'true')
      await page.getByTestId('hmi-canvas-overlay').press('Escape')
      await expect(page.getByTestId('hmi-preview-mode')).toHaveAttribute('aria-pressed', 'false')
      await expect(notice).toHaveAttribute('data-visible', 'false')
      await waitFor(page, 'the preview back in editing', async () => (await status(page)).startsWith('ready'), 60000)

      await pickLayer(page, 'Level')
      await page.getByTestId('hmi-show-in-code').click()
      await waitFor(page, 'the code view at Level', async () => (await codeText(page)).includes('Level : HmiTank'))
      await page.getByRole('button', { name: 'Designer' }).click()
      await expect(page.getByTestId('hmi-canvas-overlay')).toBeVisible()

      await undo(app)
      await save(app)
      await waitFor(page, 'the saved screen', async () => overviewOnDisk() !== OVERVIEW)
      const saved = overviewOnDisk()
      expect(saved).toContain('(* keep this comment *)')
      expect(saved).toContain('METHOD Extra : BOOL')
      expect(saved).toContain("Title : HmiLabel := (Text := 'Plant overview', Parent := 'Col'")
      expect(saved).toContain('MaxValue := 20.0')
      expect(saved).toMatch(/Lamp1 : HmiLamp := \(Parent := 'Col'[^)]*\);/)
      expect(saved).toContain('Lamp1.Value := GVL.Alarm;')
      expect(saved).toMatch(/PrefWidth := \d+/)
      expect(saved).toContain("Badge1 : Badge := (Parent := 'Col');")
      expect(saved).not.toContain('Badge1.Value := Main.Running;')

      const renameLeaf = async (from: string, to: string, choice: RegExp) => {
        await leaf(page, from).locator('span').first().dblclick()
        await page.keyboard.press('ControlOrMeta+A')
        await page.keyboard.type(to)
        await page.keyboard.press('Enter')
        await page.getByRole('button', { name: choice }).click({ timeout: 10000 })
        await waitFor(page, `the ${to} leaf`, async () => (await leaf(page, to).count()) > 0)
      }
      await renameLeaf('Badge', 'Pill', /Yes, rename references/)
      await save(app)
      await waitFor(page, 'the renamed use on disk', async () => overviewOnDisk().includes('Badge1 : Pill'))
      expect(readFileSync(join(F.project, 'hmi', 'widgets', 'Pill.st'), 'utf-8')).toMatch(
        /^FUNCTION_BLOCK Pill EXTENDS/,
      )
      await waitFor(page, 'the preview with the renamed block', async () => (await status(page)).startsWith('ready'))

      await renameLeaf('Pill', 'Chip', /Rename only/)
      await waitFor(page, 'the unresolved use reported', async () =>
        /undefined type 'pill'/i.test((await page.getByTestId('hmi-errors').allInnerTexts()).join('\n')),
      )
      await save(app)
      await waitFor(page, 'Chip on disk', async () => existsSync(join(F.project, 'hmi', 'widgets', 'Chip.st')))
      expect(overviewOnDisk()).toContain('Badge1 : Pill')
    } finally {
      app.process().kill('SIGKILL')
    }
  })
})
