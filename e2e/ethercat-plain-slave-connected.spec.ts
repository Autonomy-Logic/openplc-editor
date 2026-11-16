/**
 * A plain EtherCAT slave (Beckhoff EK1818, no mailbox) built and uploaded to a connected OpenPLC
 * Runtime v4: the project needs no new EtherDOG feature, so the gate stays silent, and the build
 * writes a busconfig with the ESI's Fixed and Mandatory PDOs and no modular section. The upload
 * replaces the program on the target.
 *
 * Needs a production build plus the preload copy (see "Electron e2e" in CLAUDE.md) and a runtime:
 * E2E_RUNTIME_HOST, E2E_RUNTIME_USER and E2E_RUNTIME_PASS. Skipped without them.
 */
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import {
  buildFromMenu,
  connectRuntime,
  EK1818_STATION,
  findFile,
  launch,
  PROJECT_NAME,
  quitApp,
  writeEthercatProject,
} from './helpers/ethercat-project'

const HOST = process.env.E2E_RUNTIME_HOST ?? ''
const USER = process.env.E2E_RUNTIME_USER ?? ''
const PASS = process.env.E2E_RUNTIME_PASS ?? ''

test('a plain slave builds and uploads with no capability warning', async () => {
  test.skip(HOST === '' || USER === '' || PASS === '', 'set E2E_RUNTIME_HOST, E2E_RUNTIME_USER and E2E_RUNTIME_PASS')
  test.setTimeout(300000)
  const { project, userData } = writeEthercatProject(join(tmpdir(), 'openplc-e2e-ethercat-plain'), HOST, EK1818_STATION)
  const { app, page } = await launch(userData)
  try {
    await page.getByText(PROJECT_NAME, { exact: true }).first().click({ timeout: 30000 })
    await connectRuntime(page, USER, PASS)
    await buildFromMenu(page, 'Build and upload')

    await expect(page.getByText('Upload complete.').first()).toBeVisible({ timeout: 240000 })
    await expect(page.getByText(/requires EtherDOG/)).toHaveCount(0)

    const build = join(project, 'build')
    const busconfig: Array<{ name: string; config: { slaves: Array<Record<string, unknown>> } }> = JSON.parse(
      readFileSync(findFile(build, 'ethercat_busconfig.json') ?? '', 'utf-8'),
    )
    const slave = busconfig[0]?.config.slaves[0]
    expect(busconfig[0]?.name).toBe('ecat_bus')
    expect(slave?.product_code).toBe('0x071a2c52')
    expect(slave).not.toHaveProperty('modular')
    expect(slave?.mandatory_pdos).toEqual(['0x1600', '0x1a00'])
    expect(slave?.rx_pdos).toEqual([expect.objectContaining({ index: '0x1600', fixed: true })])
    const iomapping = readFileSync(findFile(build, 'ethercat_iomapping.json') ?? '', 'utf-8')
    expect(iomapping).toContain('%QX0.0')
  } finally {
    await quitApp(app, page)
  }
})
