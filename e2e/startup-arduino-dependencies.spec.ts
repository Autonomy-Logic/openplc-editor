import { existsSync, symlinkSync } from 'node:fs'
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

test('missing global libraries are installed once at startup, without the simulator core, and a build waits', async () => {
  test.skip(missingPrerequisite(ARDUINO_MEGA) !== undefined, missingPrerequisite(ARDUINO_MEGA) ?? '')
  test.setTimeout(1800000)
  const { userData, sketchDir } = writeArduinoProject('openplc-e2e-startup-deps', ARDUINO_MEGA, 'empty')
  const data = join(userData, 'arduino', 'data')
  const cache = join(SOURCE_USER_DATA, 'arduino', 'data', 'staging')
  if (existsSync(cache)) symlinkSync(cache, join(data, 'staging'))

  let { app, page } = await launch(userData)
  try {
    await page.getByText(PROJECT_NAME, { exact: true }).first().click({ timeout: 30000 })
    const notice = page.getByText(new RegExp(`${INSTALLING}: `)).first()
    await expect(notice).toBeVisible({ timeout: 120000 })
    await expect(notice).not.toContainText('arduino:avr')
    await page.getByRole('button', { name: 'Build options' }).click({ timeout: 30000 })
    await page.getByText('Build only', { exact: true }).click({ timeout: 15000 })
    await expect(page.getByText(/Waiting for the editor to finish installing/).first()).toBeVisible({
      timeout: 30000,
    })
    await expect(page.getByText('Arduino components installed.').first()).toBeVisible({ timeout: 1500000 })
    await expect(page.getByRole('button', { name: 'Build options' })).toBeEnabled({ timeout: 600000 })
  } finally {
    await quitApp(app, page)
  }

  ;({ app, page } = await launch(userData))
  try {
    await page.getByText(PROJECT_NAME, { exact: true }).first().click({ timeout: 30000 })
    // The start-up check's installed-state query takes a few seconds.
    await page.waitForTimeout(5000)
    await buildAndWait(page, sketchDir, 'Build only')
    await expect(page.getByText(INSTALLING)).toHaveCount(0)
    await expect(page.getByText(/Waiting for the editor to finish installing/)).toHaveCount(0)
  } finally {
    await quitApp(app, page)
  }
})

test('offline, the startup check leaves a console warning and the build still runs', async () => {
  test.skip(missingPrerequisite(ARDUINO_MEGA) !== undefined, missingPrerequisite(ARDUINO_MEGA) ?? '')
  test.setTimeout(600000)
  const { userData } = writeArduinoProject('openplc-e2e-startup-offline', ARDUINO_MEGA, 'empty')
  // Port 9 has no listener, so every arduino-cli download fails.
  const offline = { ARDUINO_NETWORK_PROXY: 'http://127.0.0.1:9' }
  const { app, page } = await launch(userData, offline)
  try {
    await page.getByText(PROJECT_NAME, { exact: true }).first().click({ timeout: 30000 })
    await expect(page.getByText(/Could not install the Arduino components every build needs/).first()).toBeVisible({
      timeout: 300000,
    })
    await page.getByRole('button', { name: 'Build options' }).click({ timeout: 30000 })
    await page.getByText('Build only', { exact: true }).click({ timeout: 15000 })
    await expect(page.getByText('Arduino compilation failed').first()).toBeVisible({ timeout: 240000 })
  } finally {
    await quitApp(app, page)
  }
})
