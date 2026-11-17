/**
 * The HMI code view in the built app: a screen is ST of the project's language server, so an instance path completes
 * the program's variables and a wrong one is marked; on top, an element's initializer completes its properties and an
 * unknown property is marked with the HMI rule it breaks.
 *
 * Running it needs a production build plus the preload at the path a NON-packaged app looks for it; see "Electron
 * e2e" in CLAUDE.md.
 */
import { join } from 'node:path'

import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

import { hmiFixture, launchHmiApp, leaf, waitFor as waitForIn, writeHmiFixture } from './helpers/hmi-app'

const F = hmiFixture('hmi-code-view')

const PLANT = `FUNCTION_BLOCK Plant EXTENDS HmiScreen
  VAR
    Row : HmiStack := (Direction := HMI_DIRECTION#Row);
    Light : HmiLamp := (Parent := 'Row');
  END_VAR
  Light.Value := instance0.Main.Run;
END_FUNCTION_BLOCK
`

const waitFor = (page: Page, what: string, check: () => Promise<boolean>, timeoutMs?: number) =>
  waitForIn(F, page, what, check, timeoutMs)

const editor = (page: Page) => page.locator('[data-testid="hmi-code-editor"] .view-lines:visible')
/** Monaco places its popups outside the editor, so the panel around it cannot clip them. */
const suggestions = (page: Page) => page.locator('.suggest-widget:visible .monaco-list-row')

/** Puts the cursor at the end of a line, counted from 1. */
async function endOfLine(page: Page, line: number): Promise<void> {
  await editor(page).click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home')
  for (let i = 1; i < line; i++) await page.keyboard.press('ArrowDown')
  await page.keyboard.press('End')
}

/** Where the first occurrence of a word is on screen, located by its column in the monospace line. */
async function wordBox(page: Page, word: string): Promise<{ x: number; y: number; width: number; height: number }> {
  const line = page.locator('[data-testid="hmi-code-editor"] .view-line', { hasText: word }).first()
  const text = (await line.innerText()).replace(/\u00a0/g, ' ')
  const box = await line.locator(':scope > span').first().boundingBox()
  if (!box || text.length === 0) throw new Error(`no line shows ${word}`)
  const charWidth = box.width / text.trimEnd().length
  return { x: box.x + text.indexOf(word) * charWidth, y: box.y, width: word.length * charWidth, height: box.height }
}

/** Whether an error squiggle lies under the first occurrence of a word. */
async function marked(page: Page, word: string): Promise<boolean> {
  const box = await wordBox(page, word)
  for (const squiggle of await page.locator('[data-testid="hmi-code-editor"] .squiggly-error').all()) {
    const s = await squiggle.boundingBox()
    if (s && Math.abs(s.y - box.y) < box.height && s.x < box.x + box.width - 1 && s.x + s.width > box.x + 1) return true
  }
  return false
}

/** The message Monaco shows when hovering the first occurrence of a word. */
async function hoverMessage(page: Page, word: string): Promise<string> {
  await page.keyboard.press('Escape')
  await page.mouse.move(0, 0)
  const box = await wordBox(page, word)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  const hover = page.locator('.monaco-hover:visible').first()
  await expect(hover).toBeVisible({ timeout: 10000 })
  return hover.innerText()
}

test.describe('HMI code view', () => {
  test.setTimeout(180000)

  test('completes instance paths and widget properties, and marks compile errors and HMI rules', async () => {
    writeHmiFixture(F, {
      main: 'PROGRAM Main\n  VAR\n    Run : BOOL;\n    Level : REAL;\n  END_VAR\n  Run := Run;\nEND_PROGRAM\n',
      screens: { Plant: PLANT },
      startScreen: 'Plant',
    })
    const { app, page } = await launchHmiApp(F)
    try {
      await page.getByText(F.name, { exact: true }).first().click({ timeout: 30000 })
      await waitFor(page, 'the HMI branch', async () => (await leaf(page, 'Plant').count()) > 0)
      await leaf(page, 'Plant').click()
      await page.getByRole('button', { name: 'Code', exact: true }).click()
      await expect(editor(page)).toContainText('FUNCTION_BLOCK Plant', { timeout: 15000 })

      await endOfLine(page, 6)
      await page.keyboard.press('Enter')
      await page.keyboard.type('Light.Blink := instance0.Main.')
      await waitFor(page, 'the program variables offered', async () => {
        if ((await suggestions(page).count()) === 0) await page.keyboard.press('Control+Space')
        return (await suggestions(page).filter({ hasText: 'Level' }).count()) > 0
      })
      await expect(suggestions(page).filter({ hasText: 'Run' }).first()).toBeVisible()
      await page.screenshot({ path: join(F.shots, 'instance-path-completion.png') })
      await page.keyboard.press('Escape')
      await page.keyboard.type('Nope;')
      await waitFor(
        page,
        'the unknown variable marked',
        async () => (await page.locator('[data-testid="hmi-code-editor"] .squiggly-error').count()) > 0,
      )
      expect(await hoverMessage(page, 'Nope')).toContain("Program 'MAIN' has no variable 'NOPE'")
      await page.screenshot({ path: join(F.shots, 'instance-path-hover.png') })
      await expect(page.getByTestId('hmi-errors')).toHaveCount(0)
      await page.mouse.move(0, 0)

      await endOfLine(page, 4)
      for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowLeft')
      await page.keyboard.type(', ')
      await waitFor(page, 'the lamp properties offered', async () => {
        if ((await suggestions(page).count()) === 0) await page.keyboard.press('Control+Space')
        return (await suggestions(page).filter({ hasText: 'PrefWidth' }).count()) > 0
      })
      await expect(suggestions(page).filter({ hasText: /^Parent/ })).toHaveCount(0)
      await page.keyboard.type('On')
      await expect(suggestions(page).filter({ hasText: 'OnColor' }).first()).toBeVisible()
      await page.screenshot({ path: join(F.shots, 'property-completion.png') })
      await page.keyboard.press('Escape')
      for (let i = 0; i < 2; i++) await page.keyboard.press('Backspace')
      await page.keyboard.type('Bogus := 1')
      await waitFor(page, 'the unknown property marked', async () => marked(page, 'Bogus'))
      expect(await marked(page, 'Parent')).toBe(false)
      expect(await hoverMessage(page, 'Bogus')).toContain('Light: Bogus is not a property of HmiLamp')
      await page.screenshot({ path: join(F.shots, 'hmi-rule-hover.png') })
      await expect(page.getByTestId('hmi-errors')).toHaveCount(0)
      await page.screenshot({ path: join(F.shots, 'hmi-rule-marker.png') })
    } finally {
      app.process().kill('SIGKILL')
    }
  })
})
