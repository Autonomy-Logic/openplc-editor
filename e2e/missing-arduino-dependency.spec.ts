/**
 * A build never installs a core or library: with the board's core missing it fails
 * and the console ends with the hint to reinstall the board package.
 *
 * Needs a production build plus the preload copy (see "Electron e2e" in CLAUDE.md)
 * and the SLM-CPU-0 board package installed in the source user data folder.
 */
import { existsSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import {
  missingPrerequisite,
  PROJECT_NAME,
  SLM_CPU_0,
  SOURCE_USER_DATA,
  writeArduinoProject,
} from './helpers/arduino-build-project'
import { launch, quitApp } from './helpers/ethercat-project'

test('a build with the board core missing installs nothing and points at Reinstall', async () => {
  test.skip(missingPrerequisite(SLM_CPU_0) !== undefined, missingPrerequisite(SLM_CPU_0) ?? '')
  test.setTimeout(300000)
  const { userData } = writeArduinoProject('openplc-e2e-missing-core', SLM_CPU_0, 'empty')
  const data = join(userData, 'arduino', 'data')
  // The startup check installs the simulator core here; reuse the download cache for it.
  const cache = join(SOURCE_USER_DATA, 'arduino', 'data', 'staging')
  if (existsSync(cache)) symlinkSync(cache, join(data, 'staging'))
  const { app, page } = await launch(userData)
  try {
    await page.getByText(PROJECT_NAME, { exact: true }).first().click({ timeout: 30000 })
    await page.getByRole('button', { name: 'Build options' }).click({ timeout: 30000 })
    await page.getByText('Build only', { exact: true }).click({ timeout: 15000 })

    await expect(page.getByText('Arduino compilation failed').first()).toBeVisible({ timeout: 240000 })
    const hint = page.getByText(/may not be fully installed\. Open File > Board Package Manager\.\.\./).first()
    await expect(hint).toBeVisible({ timeout: 30000 })
    await expect(page.getByRole('button', { name: 'Build options' })).toBeEnabled({ timeout: 60000 })

    // The build did not install the board's core.
    expect(existsSync(join(data, 'packages', 'FACTS'))).toBe(false)
  } finally {
    await quitApp(app, page)
  }
})
