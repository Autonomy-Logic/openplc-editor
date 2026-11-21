/**
 * HMI Settings and themes in the built app (TC04): a project theme made from Autonomy with its own Accent, previewed
 * live in HMI Settings, then picked for a screen, changes the screen's semantic colors only; a fixed color stays the
 * same. The role grid is saved with the project; Runtime v4 has no local panel, so HMI Settings offers no PIN.
 *
 * Running it needs a production build plus the preload at the path a NON-packaged app looks for it; see "Electron
 * e2e" in CLAUDE.md.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

import {
  hmiFixture,
  launchHmiApp,
  leaf,
  pickLayer,
  save,
  screenOnDisk,
  status,
  waitFor as waitForIn,
  writeHmiFixture,
} from './helpers/hmi-app'

const F = hmiFixture('hmi-settings')

const OVERVIEW = `FUNCTION_BLOCK Overview EXTENDS HmiScreen
  VAR
    Row : HmiVerticalStack := (Gap := 40, Padding := 40, GrowAuto := FALSE);
    AccentBox : HmiRect := (Parent := 'Row', Fill := COLOR.Accent, PrefWidth := 160, PrefHeight := 100);
    RedBox : HmiRect := (Parent := 'Row', Fill := COLOR.Red, PrefWidth := 160, PrefHeight := 100);
  END_VAR
END_FUNCTION_BLOCK
`

const waitFor = (page: Page, what: string, check: () => Promise<boolean>, timeoutMs?: number) =>
  waitForIn(F, page, what, check, timeoutMs)
const settingsOnDisk = (): unknown => JSON.parse(readFileSync(join(F.project, 'hmi', 'settings.json'), 'utf-8'))

/** The preview's color at the centre of an element, as #RRGGBB. */
async function colorOf(page: Page, element: string): Promise<string> {
  await pickLayer(page, element)
  const box = await page.getByTestId(`hmi-selected-${element}`).boundingBox()
  if (!box) throw new Error(`${element} is not on the canvas`)
  return page.evaluate(
    ({ x, y }) => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="hmi-canvas"] canvas')
      const context = canvas?.getContext('2d')
      if (!canvas || !context) throw new Error('no preview canvas')
      const rect = canvas.getBoundingClientRect()
      const px = Math.round(((x - rect.left) * canvas.width) / rect.width)
      const py = Math.round(((y - rect.top) * canvas.height) / rect.height)
      const [r, g, b] = context.getImageData(px, py, 1, 1).data
      return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase()
    },
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  )
}

/** Picks an option of one of the designer's selects. */
async function choose(page: Page, testId: string, option: string): Promise<void> {
  await page.getByTestId(testId).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

test.describe('HMI Settings', () => {
  test.setTimeout(180000)

  test('themes a screen with a project theme, and saves the role grid (TC04)', async () => {
    writeHmiFixture(F, {
      main: 'PROGRAM Main\n  VAR\n    Run : BOOL;\n  END_VAR\n  Run := Run;\nEND_PROGRAM\n',
      screens: { Overview: OVERVIEW },
      startScreen: 'Overview',
    })
    const { app, page } = await launchHmiApp(F)
    try {
      await page.getByText(F.name, { exact: true }).first().click({ timeout: 30000 })
      await waitFor(page, 'the HMI branch', async () => (await leaf(page, 'Overview').count()) > 0)
      await leaf(page, 'Overview').click()
      await waitFor(page, 'the preview', async () => (await status(page)).startsWith('ready'), 60000)
      expect(await colorOf(page, 'AccentBox')).toBe('#0464FB')
      const red = await colorOf(page, 'RedBox')
      expect(red).toBe('#DC2626')

      await leaf(page, 'HMI Settings').click()
      await expect(page.getByTestId('hmi-settings')).toBeVisible({ timeout: 10000 })
      await expect(page.getByTestId('hmi-address')).toHaveText('https://<device IP>:8443/hmi/')
      await page.getByTestId('hmi-theme-new-name').fill('Brand')
      await page.getByTestId('hmi-theme-new-name').press('Enter')
      await page.getByTestId('hmi-theme-add').click()
      await expect(page.getByTestId('hmi-theme-Brand')).toBeVisible({ timeout: 10000 })
      await page.getByTestId('hmi-theme-hex-Accent').fill('#E91E63')
      await page.getByTestId('hmi-theme-hex-Accent').press('Enter')
      await waitFor(page, 'the theme preview', async () =>
        ((await page.getByTestId('hmi-theme-preview').getAttribute('data-preview')) ?? '').startsWith('ready'),
      )
      await page.getByTestId('hmi-role-Overview-operator').check()
      await expect(page.getByTestId('hmi-local-panel-none')).toBeVisible()
      await expect(page.getByRole('checkbox', { name: 'Require a PIN' })).toHaveCount(0)
      await page.waitForTimeout(800)
      await page.screenshot({ path: join(F.shots, 'tc04-settings.png') })
      await page.getByTestId('hmi-themes').scrollIntoViewIfNeeded()
      await page.getByTestId('hmi-themes').screenshot({ path: join(F.shots, 'tc04-themes.png') })

      await leaf(page, 'Overview').click()
      await expect(page.getByTestId('hmi-designer')).toBeVisible()
      await waitFor(
        page,
        'the preview with the new theme listed',
        async () => (await status(page)).startsWith('ready'),
        60000,
      )
      const before = await status(page)
      await choose(page, 'hmi-theme', 'Theme: Brand')
      await waitFor(
        page,
        'the preview in the project theme',
        async () => (await status(page)) !== before && (await status(page)).startsWith('ready'),
        60000,
      )
      expect(await colorOf(page, 'AccentBox')).toBe('#E91E63')
      expect(await colorOf(page, 'RedBox')).toBe(red)
      await page.screenshot({ path: join(F.shots, 'tc04-themed.png') })

      await save(app)
      await waitFor(page, 'the theme on the screen', async () => screenOnDisk(F, 'Overview').includes("'Brand'"))
      expect(screenOnDisk(F, 'Overview')).toMatch(/^\{attribute 'hmi_theme' := 'Brand'\}\nFUNCTION_BLOCK Overview/)
      await waitFor(page, 'the settings on disk', async () => JSON.stringify(settingsOnDisk()).includes('Brand'))
      expect(settingsOnDisk()).toMatchObject({
        themes: [{ name: 'Brand', base: 'Autonomy', colors: { Accent: '#E91E63' } }],
        roles: { Overview: { engineer: true, operator: true, viewer: false } },
      })
    } finally {
      app.process().kill('SIGKILL')
    }
  })

  test("shows where browsers open the HMI: the device's address on Runtime v4 (FR15)", async () => {
    writeHmiFixture(F, {
      main: 'PROGRAM Main\n  VAR\n    Run : BOOL;\n  END_VAR\n  Run := Run;\nEND_PROGRAM\n',
      screens: { Overview: OVERVIEW },
      startScreen: 'Overview',
      runtimeIpAddress: '192.168.1.20',
    })
    const { app, page } = await launchHmiApp(F)
    try {
      await page.getByText(F.name, { exact: true }).first().click({ timeout: 30000 })
      await waitFor(page, 'the HMI branch', async () => (await leaf(page, 'HMI Settings').count()) > 0)
      await leaf(page, 'HMI Settings').click()
      await expect(page.getByTestId('hmi-address')).toHaveText('https://192.168.1.20:8443/hmi/', { timeout: 10000 })
      await page.getByTestId('hmi-settings').screenshot({ path: join(F.shots, 'fr15-address.png') })
    } finally {
      app.process().kill('SIGKILL')
    }
  })
})
