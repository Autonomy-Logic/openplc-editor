/**
 * A drive whose ESI gives an 8-bit sub-item four bytes of DefaultData shows each sub-item at its
 * own width in Startup Parameters, instead of 4261412607 for the signed one.
 *
 * Needs a production build plus the preload copy; see "Electron e2e" in CLAUDE.md.
 */
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import {
  INTERPOLATION_DRIVE_STATION,
  launch,
  PROJECT_NAME,
  quitApp,
  writeEthercatProject,
} from './helpers/ethercat-project'

test('an oversized DefaultData decodes at the sub-item width in Startup Parameters', async () => {
  test.setTimeout(300000)
  const { userData } = writeEthercatProject(
    join(tmpdir(), 'openplc-e2e-ethercat-sdo-defaults'),
    '',
    INTERPOLATION_DRIVE_STATION,
  )
  const { app, page } = await launch(userData)
  try {
    await page.getByText(PROJECT_NAME, { exact: true }).first().click({ timeout: 30000 })
    await page.getByText('ecat_bus', { exact: true }).first().dblclick({ timeout: 60000 })
    await page.getByText('Interpolation drive', { exact: true }).first().dblclick({ timeout: 60000 })
    await page.getByText('Startup Parameters', { exact: true }).first().click({ timeout: 60000 })

    await expect(page.getByText('1 object(s), 2 parameter(s)')).toBeVisible({ timeout: 60000 })
    await expect(page.getByRole('row', { name: /Interpolation time index/ })).toContainText('-1')
    await expect(page.getByRole('row', { name: /Interpolation time period value/ })).toContainText('1')
    await expect(page.getByText('4261412607')).toHaveCount(0)
  } finally {
    await quitApp(app, page)
  }
})
