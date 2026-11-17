/**
 * The HMI designer's panels in the built app, in the light and dark editor themes: the canvas has the FBD editor's
 * dotted background and controls; a selected Layers row shows the hover background in bold; the Variables tab is a
 * tree that opens and closes and binds a nested variable by drag; a trend adds, colours and removes data series, and
 * its first series cannot be removed.
 *
 * Running it needs a production build plus the preload at the path a NON-packaged app looks for it; see "Electron
 * e2e" in CLAUDE.md. Every wait also reads the app's own error text and fails at once when the app reports one.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ElectronApplication, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

import {
  hmiFixture,
  htmlDrag,
  launchHmiApp,
  leaf,
  pickLayer,
  save,
  screenOnDisk,
  status,
  waitFor as waitForIn,
  writeHmiFixture,
} from './helpers/hmi-app'

const F = hmiFixture('hmi-designer-panels')

const MAIN =
  'PROGRAM Main\n  VAR\n    Level : REAL := 6.5;\n    Speed : INT;\n    Run : BOOL;\n    T1 : TON;\n    P : Pt;\n    Arr : ARRAY[0..3] OF INT;\n  END_VAR\n  T1(IN := Run, PT := T#1s);\nEND_PROGRAM\n'
const PT = 'TYPE Pt :\n  STRUCT\n    X : REAL;\n    Y : INT;\n  END_STRUCT;\nEND_TYPE\n'
const OVERVIEW = `FUNCTION_BLOCK Overview EXTENDS HmiScreen
  VAR
    Body : HmiHorizontalStack;
    Row : HmiVerticalStack := (Parent := 'Body', PrefHeight := 80, GrowAuto := FALSE);
    Lamp1 : HmiLamp := (Parent := 'Row', Caption := 'Run');
    Shown : HmiValue := (Parent := 'Row', Caption := 'P.X');
    Item : HmiSlider := (Parent := 'Row', Caption := 'Arr[2]');
    Trend1 : HmiTrend := (Parent := 'Body', Caption := 'Level');
  END_VAR
  Trend1.Value := instance0.Main.Level;
END_FUNCTION_BLOCK
`

const THEMES = ['light', 'dark', 'nineties'] as const
type Theme = (typeof THEMES)[number]

const themeOf = (page: Page): Promise<Theme | undefined> =>
  page.locator('html').evaluate((root, themes) => themes.find((t) => root.classList.contains(t)), [...THEMES])

/** Clicks the editor's Change Theme menu item until the editor shows `theme`. */
async function setTheme(app: ElectronApplication, page: Page, theme: Theme): Promise<void> {
  for (let i = 0; i < THEMES.length; i++) {
    const current = await themeOf(page)
    if (current === theme) return
    await app.evaluate(({ Menu }) => {
      const pending = [...(Menu.getApplicationMenu()?.items ?? [])]
      for (let item = pending.shift(); item; item = pending.shift()) {
        if (item.label === 'Change Theme') return item.click()
        pending.push(...(item.submenu?.items ?? []))
      }
      throw new Error('no Change Theme menu item')
    })
    await expect.poll(() => themeOf(page)).not.toBe(current)
  }
  expect(await themeOf(page)).toBe(theme)
}

const waitFor = (page: Page, what: string, check: () => Promise<boolean>, timeoutMs?: number) =>
  waitForIn(F, page, what, check, timeoutMs)
const ready = (page: Page) => waitFor(page, 'the preview', async () => (await status(page)).startsWith('ready'), 60000)
const css = (page: Page, selector: string, property: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), property)

/**
 * Pixels of the window in `rect` (CSS pixels) that stand out from the region's most common shade by more than 25 in
 * luminance: the dots of an otherwise empty stretch of canvas.
 */
async function standOut(app: ElectronApplication, rect: { x: number; y: number; width: number; height: number }) {
  return app.evaluate(async ({ BrowserWindow }, r) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'))
    if (!win) throw new Error('no main window')
    const bitmap = (await win.webContents.capturePage(r)).toBitmap()
    const shades: number[] = []
    for (let i = 0; i + 3 < bitmap.length; i += 4)
      shades.push(Math.round(0.11 * bitmap[i] + 0.59 * bitmap[i + 1] + 0.3 * bitmap[i + 2]))
    const counts = new Map<number, number>()
    for (const l of shades) counts.set(l, (counts.get(l) ?? 0) + 1)
    const mode = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
    return { total: shades.length, background: mode, dots: shades.filter((l) => Math.abs(l - mode) > 25).length }
  }, rect)
}

/** What the FBD editor's canvas looks like in each theme: control background and border, and the dots. */
const FBD = {
  light: { button: 'rgb(245, 245, 245)', border: 'rgb(208, 208, 208)', dots: 'rgb(145, 145, 154)' },
  dark: { button: 'rgb(46, 48, 56)', border: 'rgb(46, 48, 56)', dots: 'rgb(145, 145, 154)' },
}

test.describe('HMI designer panels', () => {
  test.setTimeout(240000)

  test('canvas, Layers, Variables and trend series, in the light and dark themes', async () => {
    writeHmiFixture(F, { main: MAIN, screens: { Overview: OVERVIEW }, startScreen: 'Overview' })
    mkdirSync(join(F.project, 'datatypes'), { recursive: true })
    writeFileSync(join(F.project, 'datatypes', 'Pt.dt'), PT)
    const { app, page } = await launchHmiApp(F)
    try {
      await page.getByText(F.name, { exact: true }).first().click({ timeout: 30000 })
      await waitFor(page, 'the HMI branch', async () => (await leaf(page, 'Overview').count()) > 0)
      await leaf(page, 'Overview').click()
      await expect(page.getByTestId('hmi-designer')).toBeVisible({ timeout: 15000 })
      await ready(page)

      for (const theme of ['light', 'dark'] as const) {
        await setTheme(app, page, theme)
        await page.waitForTimeout(300)
        const area = '[data-testid="hmi-canvas-area"]'
        expect(await css(page, `${area} .react-flow__background-pattern.dots`, 'fill')).toBe(FBD[theme].dots)
        const areaBox = await page.getByTestId('hmi-canvas-area').boundingBox()
        if (!areaBox) throw new Error('no canvas area')
        const empty = { x: Math.round(areaBox.x + 4), y: Math.round(areaBox.y + 70), width: 40, height: 80 }
        const sample = await standOut(app, empty)
        expect(sample.dots).toBeGreaterThan(2)
        expect(sample.dots).toBeLessThan(sample.total / 4)
        const zoomIn = `${area} [data-testid="hmi-zoom-in"]`
        expect(await page.locator(zoomIn).getAttribute('class')).toContain('react-flow__controls-button')
        expect(await css(page, zoomIn, 'background-color')).toBe(FBD[theme].button)
        expect(await css(page, zoomIn, 'border-bottom-color')).toBe(FBD[theme].border)
        await page.getByTestId('hmi-canvas-area').screenshot({ path: join(F.shots, `${theme}-1-canvas.png`) })

        await pickLayer(page, 'Lamp1')
        const row = page.getByTestId('hmi-outline-Lamp1')
        await expect(row).toHaveClass(/font-medium/)
        expect(await row.evaluate((el) => getComputedStyle(el).fontWeight)).toBe('500')
        expect(await row.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
          theme === 'light' ? 'rgb(237, 239, 242)' : 'rgb(46, 48, 56)',
        )
        await page.getByTestId('hmi-palette').screenshot({ path: join(F.shots, `${theme}-2-layers-selected.png`) })

        await page.getByTestId('hmi-palette-tab-variables').click()
        const program = page.getByTestId('hmi-variable-node-instance0.Main')
        await expect(program).toHaveAttribute('aria-expanded', 'true')
        await program.click()
        await expect(program).toHaveAttribute('aria-expanded', 'false')
        await expect(page.getByTestId('hmi-variable-instance0.Main.Run')).toHaveCount(0)
        await page.getByTestId('hmi-palette').screenshot({ path: join(F.shots, `${theme}-3-variables-closed.png`) })
        await program.click()
        await expect(page.getByTestId('hmi-variable-instance0.Main.Run')).toBeVisible()
        await page.getByTestId('hmi-palette').screenshot({ path: join(F.shots, `${theme}-3-variables-open.png`) })
      }

      await setTheme(app, page, 'light')
      expect(await leaf(page, 'Overview').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
        'rgb(237, 239, 242)',
      )
      await page.screenshot({
        path: join(F.shots, 'light-0-project-tree-selected.png'),
        clip: { x: 0, y: 0, width: 420, height: 520 },
      })
      for (const [element, variable] of [
        ['Lamp1', 'instance0.Main.T1.Q'],
        ['Shown', 'instance0.Main.P.X'],
        ['Item', 'instance0.Main.Arr[2]'],
      ] as const) {
        await pickLayer(page, element)
        const box = await page.getByTestId(`hmi-selected-${element}`).boundingBox()
        const overlay = await page.getByTestId('hmi-canvas-overlay').boundingBox()
        if (!box || !overlay) throw new Error(`${element} is not on the canvas`)
        await page.getByTestId('hmi-palette-tab-variables').click()
        await expect(page.getByTestId(`hmi-variable-${variable}`)).toBeVisible({ timeout: 30000 })
        await htmlDrag(
          page,
          `hmi-variable-${variable}`,
          box.x - overlay.x + box.width / 2,
          box.y - overlay.y + box.height / 2,
        )
        await expect(page.getByTestId('hmi-main-binding')).toContainText(variable, { timeout: 10000 })
      }
      await page.getByTestId('hmi-palette').screenshot({ path: join(F.shots, 'light-3-variables-nested.png') })
      await ready(page)
      await expect(page.getByTestId('hmi-errors')).toHaveCount(0)

      await pickLayer(page, 'Trend1')
      await page.getByTestId('hmi-prop-tab-data').click()
      await expect(page.getByTestId('hmi-series-1')).toBeVisible()
      await expect(page.getByTestId('hmi-series-1-remove')).toHaveCount(0)
      await page.getByTestId('hmi-series-add').click()
      await expect(page.getByTestId('hmi-series-2')).toBeVisible()
      await page.getByTestId('hmi-series-2-binding').click()
      await page.getByRole('option', { name: /instance0\.Main\.Speed/ }).click()
      await expect(page.getByTestId('hmi-series-2-binding')).toContainText('instance0.Main.Speed')
      await page.getByTestId('hmi-prop-Color2').click()
      await page.getByRole('option', { name: 'Danger', exact: true }).click()
      await page.getByTestId('hmi-series-add').click()
      await expect(page.getByTestId('hmi-series-3')).toBeVisible()
      await ready(page)
      await page.screenshot({ path: join(F.shots, 'light-4-trend-series.png') })
      await setTheme(app, page, 'dark')
      await page.waitForTimeout(300)
      await page.screenshot({ path: join(F.shots, 'dark-4-trend-series.png') })
      await setTheme(app, page, 'light')

      await page.getByTestId('hmi-series-3-remove').click()
      await expect(page.getByTestId('hmi-series-3')).toHaveCount(0)
      await expect(page.getByTestId('hmi-series-1-remove')).toHaveCount(0)
      await save(app)
      await waitFor(page, 'the saved screen', async () => screenOnDisk(F, 'Overview').includes('Trend1.Value2'))
      const saved = screenOnDisk(F, 'Overview')
      expect(saved).toMatch(/Trend1 : HmiTrend := \([^)]*Pens := 2/)
      expect(saved).toContain('Color2 := COLOR.Danger')
      expect(saved).toContain('Trend1.Value2 := instance0.Main.Speed;')
      expect(saved).toContain('Lamp1.Value := instance0.Main.T1.Q;')
      expect(saved).toContain('Shown.Value := instance0.Main.P.X;')
      expect(saved).toContain('Item.Value := instance0.Main.Arr[2];')

      await page.getByTestId('hmi-series-2-remove').click()
      await expect(page.getByTestId('hmi-series-2')).toHaveCount(0)
      await save(app)
      await waitFor(page, 'one series on disk', async () => !screenOnDisk(F, 'Overview').includes('Trend1.Value2'))
      expect(screenOnDisk(F, 'Overview')).toMatch(/Pens := 1/)
      expect(screenOnDisk(F, 'Overview')).not.toContain('Color2')
      await ready(page)
      await expect(page.getByTestId('hmi-errors')).toHaveCount(0)
    } finally {
      app.process().kill('SIGKILL')
    }
  })
})
