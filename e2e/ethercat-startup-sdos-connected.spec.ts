/**
 * A CiA 402 drive with 40 startup SDOs builds and uploads to a runtime at 4.3.2 or newer.
 * Needs a production build, the preload copy (CLAUDE.md) and E2E_RUNTIME_HOST/USER/PASS.
 */
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { isDynamicEtherdogRuntime } from '../src/backend/shared/firmware/runtime-version-gate'

import {
  buildFromMenu,
  CIA402_SDO_STATION,
  connectRuntime,
  findFile,
  launch,
  PROJECT_NAME,
  quitApp,
  runtimeApi,
  writeEthercatProject,
} from './helpers/ethercat-project'

const HOST = process.env.E2E_RUNTIME_HOST ?? ''
const USER = process.env.E2E_RUNTIME_USER ?? ''
const PASS = process.env.E2E_RUNTIME_PASS ?? ''
// Index of the first user startup SDO in the fixture; the rest follow consecutively
const FIRST_SDO_INDEX = 0x2100

test('a slave with more than 32 startup SDOs builds and uploads', async () => {
  test.skip(HOST === '' || USER === '' || PASS === '', 'set E2E_RUNTIME_HOST, E2E_RUNTIME_USER and E2E_RUNTIME_PASS')
  test.setTimeout(300000)
  const { version } = await runtimeApi(HOST, 'GET', '/api/version')
  test.skip(!isDynamicEtherdogRuntime(String(version)), `runtime ${String(version)} holds SDOs in fixed arrays`)
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

    const busconfigPath = findFile(join(project, 'build'), 'ethercat_busconfig.json')
    expect(busconfigPath, 'the build wrote ethercat_busconfig.json').toBeDefined()
    const busconfig: Array<{ config: { slaves: Array<{ sdo_configurations: Array<{ index: string }> }> } }> =
      JSON.parse(readFileSync(busconfigPath ?? '', 'utf-8'))
    const indices = (busconfig[0]?.config.slaves[0]?.sdo_configurations ?? []).map((s) => s.index.toLowerCase())
    const expected = Array.from(
      { length: CIA402_SDO_STATION.startupSdos },
      (_, i) => `0x${(FIRST_SDO_INDEX + i).toString(16)}`,
    )
    expect(indices).toEqual(expect.arrayContaining(expected))
  } finally {
    await quitApp(app, page)
  }
})
