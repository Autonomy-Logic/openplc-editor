/**
 * A widget block's tab in the built app: the preview draws the block once, in a box of its preferred size, warns when
 * its drawing reaches past that box, and a drawing call with fixed coordinates fails the build, marked in the code.
 *
 * Running it needs a production build plus the preload at the path a NON-packaged app looks for it; see "Electron
 * e2e" in CLAUDE.md. Every wait also reads the app's own error text and fails at once when the app reports one.
 */
import { expect, test } from '@playwright/test'

import { hmiFixture, launchHmiApp, leaf, status, waitFor, writeHmiFixture } from './helpers/hmi-app'

const F = hmiFixture('hmi-widget-preview')

const block = (name: string, draw: string) => `FUNCTION_BLOCK ${name} EXTENDS HmiElement
  VAR_INPUT
    {attribute 'hmi_main'}
    Value : BOOL;
  END_VAR
  METHOD PROTECTED OVERRIDE NaturalWidth : DINT
    NaturalWidth := 45;
  END_METHOD
  METHOD PROTECTED OVERRIDE NaturalHeight : DINT
    NaturalHeight := 200;
  END_METHOD
  METHOD PROTECTED OVERRIDE Draw : BOOL
    ${draw}
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK
`

const MAIN = 'PROGRAM Main\n  VAR\n    Running : BOOL;\n  END_VAR\n  Running := Running;\nEND_PROGRAM\n'
const OVERVIEW =
  'FUNCTION_BLOCK Overview EXTENDS HmiScreen\n  VAR\n    Col : HmiHorizontalStack;\n  END_VAR\nEND_FUNCTION_BLOCK\n'

/** Writes a project with these widget blocks, launches the app and opens the project. */
async function open(widgets: Record<string, string>) {
  writeHmiFixture(F, { main: MAIN, globals: [], screens: { Overview: OVERVIEW }, widgets, startScreen: 'Overview' })
  const opened = await launchHmiApp(F)
  await opened.page.getByText('hmi-widget-preview', { exact: true }).first().click({ timeout: 30000 })
  const first = Object.keys(widgets)[0]
  await waitFor(F, opened.page, 'the HMI branch', async () => (await leaf(opened.page, first).count()) > 0)
  return opened
}

test.describe('HMI widget preview', () => {
  test.setTimeout(180000)

  test('draws a block once in its box, outline included, and warns when it draws past the box', async () => {
    const { app, page } = await open({
      Tall: block(
        'Tall',
        'HMI_FillRect(Left, Top, Width, Height, 5, COLOR.Danger); HMI_StrokeRect(Left, Top, Width, Height, 5, 4, COLOR.Text);',
      ),
      Wide: block('Wide', 'HMI_FillRect(Left - 10, Top, Width + 30, Height, 5, COLOR.Danger);'),
    })
    try {
      const box = page.locator('[data-testid="hmi-widget-box"]:visible')
      const overflow = page.locator('[data-testid="hmi-widget-overflow"]:visible')
      await leaf(page, 'Tall').click()
      await waitFor(
        F,
        page,
        'the Tall box',
        async () => (await box.getAttribute('title').catch(() => null)) === '45 × 200',
        60000,
      )
      expect(await page.locator('[data-testid="hmi-widget-canvas"]:visible').count()).toBe(1)
      await page.waitForTimeout(1500)
      expect(await overflow.count()).toBe(0)

      await leaf(page, 'Wide').click()
      await waitFor(F, page, 'the overflow notice', async () => (await overflow.count()) > 0, 60000)
      await expect(overflow).toContainText('10 lu to the left, 20 lu to the right')
    } finally {
      app.process().kill('SIGKILL')
    }
  })

  test('fails the build of a block that draws at fixed coordinates, marked in its code', async () => {
    const { app, page } = await open({ Fixed: block('Fixed', 'HMI_FillRect(20, 20, 100, 100, 5, COLOR.Danger);') })
    try {
      await leaf(page, 'Fixed').click()
      await waitFor(F, page, 'the failed preview', async () => (await status(page)).startsWith('failed'), 60000)
      await waitFor(
        F,
        page,
        'the fixed-coordinate mark',
        async () => (await page.locator('[data-testid="hmi-widget-editor"]:visible .squiggly-error').count()) > 0,
      )
    } finally {
      app.process().kill('SIGKILL')
    }
  })
})
