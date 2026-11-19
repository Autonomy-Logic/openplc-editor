/**
 * The workspace's bottom panel starts hidden, with a strip of its tabs at the bottom of the editor column. A strip
 * button opens it on that tab, the X hides it, the strip's chevron reopens it on the last tab used, and Ctrl/Cmd+J
 * toggles it. Play opens the hidden panel on the Console. Running needs a production build; see "Electron e2e" in
 * CLAUDE.md.
 */
import { join } from 'node:path'

import { expect, type Page } from '@playwright/test'

import { waitForApp } from './helpers/app-console'
import { openNewProject, test } from './helpers/editor-session'

const FIXTURE = join(
  __dirname,
  '..',
  'src',
  'backend',
  'shared',
  'simulator',
  '__tests__',
  'fixtures',
  'simulator-project',
)

const strip = (page: Page) => page.getByRole('toolbar', { name: 'Bottom panel' })
const hideButton = (page: Page) => page.getByRole('button', { name: 'Hide panel' })
const panelSize = (page: Page) =>
  page.locator('[data-panel-id="consolePanel"]').evaluate((el) => Number(el.getAttribute('data-panel-size')))

async function expectHidden(page: Page): Promise<void> {
  await expect(strip(page)).toBeVisible({ timeout: 10000 })
  await expect(hideButton(page)).toBeHidden()
  expect(await panelSize(page)).toBe(0)
}

async function expectOpenOn(page: Page, tab: string): Promise<void> {
  await expect(hideButton(page)).toBeVisible({ timeout: 10000 })
  await expect(strip(page)).toBeHidden()
  await expect(page.getByRole('tab', { name: tab })).toHaveAttribute('data-state', 'active')
  expect(await panelSize(page)).toBeGreaterThanOrEqual(22)
}

test('the bottom panel starts hidden and opens and hides from the strip, the X and Ctrl/Cmd+J', async ({ editor }) => {
  test.setTimeout(180000)
  const { page } = editor
  await openNewProject(editor, FIXTURE, 'bottom-panel')

  await expectHidden(page)
  await expect(strip(page).getByRole('button', { name: 'Console' })).toBeVisible()

  await strip(page).getByRole('button', { name: 'Console' }).click()
  await expectOpenOn(page, 'Console')
  const firstSize = await panelSize(page)
  expect(firstSize).toBeCloseTo(31, 0)

  await hideButton(page).click()
  await expectHidden(page)

  await page.keyboard.press('ControlOrMeta+j')
  await expectOpenOn(page, 'Console')
  expect(await panelSize(page)).toBeCloseTo(firstSize, 0)

  await page.keyboard.press('ControlOrMeta+j')
  await expectHidden(page)

  await strip(page).getByRole('button', { name: 'Show panel' }).click()
  await expectOpenOn(page, 'Console')
  await hideButton(page).click()
  await expectHidden(page)
})

test('Play opens the hidden bottom panel on the Console', async ({ editor }) => {
  test.setTimeout(180000)
  const { page } = editor
  await openNewProject(editor, FIXTURE, 'bottom-panel-play')
  await expectHidden(page)

  const play = page.getByRole('button', { name: 'Play' })
  await play.click({ timeout: 60000 })
  await waitForApp(page, async () => (await panelSize(page)) > 0, {
    timeout: 60000,
    message: 'Play did not open the bottom panel',
  })
  await expect(page.getByRole('tab', { name: 'Console' })).toHaveAttribute('data-state', 'active')
  await expect(strip(page)).toBeHidden()
})
