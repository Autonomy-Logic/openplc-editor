/**
 * At startup the editor installs the simulator's core and the global libraries
 * when they are missing (global libraries the Arduino sketchbook already has count as
 * installed); a build started meanwhile waits for it. Once installed,
 * a restart installs nothing. Offline, the console keeps a warning and builds
 * still run.
 *
 * Archives come from this machine's arduino-cli download cache when present;
 * the first test needs the network for the index and anything not cached.
 * Needs a production build plus the preload copy (see "Electron e2e" in CLAUDE.md).
 */
import { existsSync, statSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import {
  ARDUINO_MEGA,
  buildAndWait,
  missingPrerequisite,
  PROJECT_NAME,
  SOURCE_USER_DATA,
  writeArduinoProject,
} from './helpers/arduino-build-project'
import { launch, quitApp } from './helpers/ethercat-project'

const INSTALLING = 'Installing Arduino components every build needs'

test('missing simulator core and global libraries are installed once at startup, and a build waits', async () => {
  test.skip(missingPrerequisite(ARDUINO_MEGA) !== undefined, missingPrerequisite(ARDUINO_MEGA) ?? '')
  test.setTimeout(1800000)
  const { userData, sketchDir } = writeArduinoProject('openplc-e2e-startup-deps', ARDUINO_MEGA, 'empty')
  const data = join(userData, 'arduino', 'data')
  const cache = join(SOURCE_USER_DATA, 'arduino', 'data', 'staging')
  if (existsSync(cache)) symlinkSync(cache, join(data, 'staging'))
  const avr = join(data, 'packages', 'arduino', 'hardware', 'avr')

  let { app, page } = await launch(userData)
  try {
    await page.getByText(PROJECT_NAME, { exact: true }).first().click({ timeout: 30000 })
    await expect(page.getByText(new RegExp(`${INSTALLING}: arduino:avr[,.]`)).first()).toBeVisible({ timeout: 120000 })
    // Started while the check runs, the build waits for it and then succeeds with the core it installed.
    await page.getByRole('button', { name: 'Build options' }).click({ timeout: 30000 })
    await page.getByText('Build only', { exact: true }).click({ timeout: 15000 })
    await expect(page.getByText(/Waiting for the editor to finish installing/).first()).toBeVisible({
      timeout: 30000,
    })
    await expect(page.getByText('Arduino components installed.').first()).toBeVisible({ timeout: 1500000 })
    await expect(page.getByRole('button', { name: 'Build options' })).toBeEnabled({ timeout: 600000 })
    expect(existsSync(avr)).toBe(true)
  } finally {
    await quitApp(app, page)
  }

  // Everything is present now: the restart installs nothing and the build runs at once.
  const avrTime = statSync(avr).mtimeMs
  ;({ app, page } = await launch(userData))
  try {
    await page.getByText(PROJECT_NAME, { exact: true }).first().click({ timeout: 30000 })
    // Let the start-up check finish its installed-state query, which takes a few seconds even when nothing is missing.
    await page.waitForTimeout(5000)
    await buildAndWait(page, sketchDir, 'Build only')
    await expect(page.getByText(INSTALLING)).toHaveCount(0)
    await expect(page.getByText(/Waiting for the editor to finish installing/)).toHaveCount(0)
    expect(statSync(avr).mtimeMs).toBe(avrTime)
  } finally {
    await quitApp(app, page)
  }
})

test('offline, the startup check leaves a console warning and the build still runs', async () => {
  test.skip(missingPrerequisite(ARDUINO_MEGA) !== undefined, missingPrerequisite(ARDUINO_MEGA) ?? '')
  test.setTimeout(600000)
  const { userData } = writeArduinoProject('openplc-e2e-startup-offline', ARDUINO_MEGA, 'empty')
  // arduino-cli's own proxy setting; nothing listens on port 9, so every download fails as offline.
  const offline = { ARDUINO_NETWORK_PROXY: 'http://127.0.0.1:9' }
  const { app, page } = await launch(userData, offline)
  try {
    await page.getByText(PROJECT_NAME, { exact: true }).first().click({ timeout: 30000 })
    await expect(page.getByText(/Could not install the Arduino components every build needs/).first()).toBeVisible({
      timeout: 300000,
    })
    await page.getByRole('button', { name: 'Build options' }).click({ timeout: 30000 })
    await page.getByText('Build only', { exact: true }).click({ timeout: 15000 })
    // The build is attempted and fails on the missing core with the repair hint.
    await expect(page.getByText('Arduino compilation failed').first()).toBeVisible({ timeout: 240000 })
  } finally {
    await quitApp(app, page)
  }
})
