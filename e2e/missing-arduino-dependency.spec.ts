/**
 * A build never installs a core or library: with the board's core missing it fails
 * and the console ends with the hint to reinstall the board package.
 *
 * Needs a production build plus the preload copy (see "Electron e2e" in CLAUDE.md)
 * and the Arduino board package installed in the source user data folder.
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { ARDUINO_MEGA, missingPrerequisite, PROJECT_NAME, writeArduinoProject } from './helpers/arduino-build-project'
import { launch, quitApp } from './helpers/ethercat-project'

test('a build with the board core missing installs nothing and points at Reinstall', async () => {
  test.skip(missingPrerequisite(ARDUINO_MEGA) !== undefined, missingPrerequisite(ARDUINO_MEGA) ?? '')
  test.setTimeout(300000)
  const { userData } = writeArduinoProject('openplc-e2e-missing-core', ARDUINO_MEGA, 'empty')
  const data = join(userData, 'arduino', 'data')
  const { app, page } = await launch(userData)
  try {
    await page.getByText(PROJECT_NAME, { exact: true }).first().click({ timeout: 30000 })
    await page.getByRole('button', { name: 'Build options' }).click({ timeout: 30000 })
    await page.getByText('Build only', { exact: true }).click({ timeout: 15000 })

    await expect(page.getByText('Arduino compilation failed').first()).toBeVisible({ timeout: 240000 })
    const hint = page.getByText(/may not be fully installed\. Open File > Board Package Manager\.\.\./).first()
    await expect(hint).toBeVisible({ timeout: 30000 })
    await expect(page.getByRole('button', { name: 'Build options' })).toBeEnabled({ timeout: 60000 })

    // The build installed no core; arduino-cli only unpacks its own tools under packages/builtin.
    const packages = join(data, 'packages')
    expect((existsSync(packages) ? readdirSync(packages) : []).filter((vendor) => vendor !== 'builtin')).toEqual([])
  } finally {
    await quitApp(app, page)
  }
})
