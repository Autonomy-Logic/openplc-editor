/**
 * A CiA 402 drive with 40 startup SDOs builds and uploads to a runtime at 4.3.2 or newer.
 * Needs a production build, the preload copy (CLAUDE.md) and E2E_RUNTIME_HOST/USER/PASS.
 */
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import {
  buildFromMenu,
  CIA402_SDO_STATION,
  connectRuntime,
  findFile,
  launch,
  PROJECT_NAME,
  quitApp,
  writeEthercatProject,
} from './helpers/ethercat-project'

const HOST = process.env.E2E_RUNTIME_HOST ?? ''
const USER = process.env.E2E_RUNTIME_USER ?? ''
const PASS = process.env.E2E_RUNTIME_PASS ?? ''

test('a slave with more than 32 startup SDOs builds and uploads', async () => {
  test.skip(HOST === '' || USER === '' || PASS === '', 'set E2E_RUNTIME_HOST, E2E_RUNTIME_USER and E2E_RUNTIME_PASS')
  test.setTimeout(300000)
  const { project, userData } = writeEthercatProject(
    join(tmpdir(), 'openplc-e2e-ethercat-sdos'),
    HOST,
    CIA402_SDO_STATION,
  )
  const { app, page } = await launch(userData)
  try {
    await page.getByText(PROJECT_NAME, { exact: true }).first().click({ timeout: 30000 })
    await connectRuntime(page, USER, PASS)
    await buildFromMenu(page, 'Build and upload')

    await expect(page.getByText('Program uploaded successfully to runtime.').first()).toBeVisible({
      timeout: 240000,
    })
    await expect(page.getByText(/SDO configurations; at most/)).toHaveCount(0)
    await expect(page.getByText(/EtherCAT configuration is invalid/)).toHaveCount(0)

    const busconfig: Array<{ config: { slaves: Array<{ sdo_configurations: Array<{ index: string }> }> } }> =
      JSON.parse(readFileSync(findFile(join(project, 'build'), 'ethercat_busconfig.json') ?? '', 'utf-8'))
    const sdos = busconfig[0]?.config.slaves[0]?.sdo_configurations ?? []
    expect(sdos.length).toBeGreaterThan(32)
    for (let i = 0; i < 40; i++) {
      expect(sdos.map((s) => s.index.toUpperCase())).toContain(`0X${(0x2100 + i).toString(16).toUpperCase()}`)
    }
  } finally {
    await quitApp(app, page)
  }
})
