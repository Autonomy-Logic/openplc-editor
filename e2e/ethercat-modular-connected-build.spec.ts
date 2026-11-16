/**
 * The modular station built and uploaded to a connected OpenPLC Runtime v4 with EtherDOG 1.0.0: the
 * gate passes on the advertised features, and the build writes the EtherDOG busconfig and I/O
 * mapping the runtime takes, with the station, mandatory and fixed PDO fields and the module list
 * write. The upload replaces the program on the target.
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
  findFile,
  launch,
  PROJECT_NAME,
  quitApp,
  UR20_STATION,
  writeEthercatProject,
} from './helpers/ethercat-project'

const HOST = process.env.E2E_RUNTIME_HOST ?? ''
const USER = process.env.E2E_RUNTIME_USER ?? ''
const PASS = process.env.E2E_RUNTIME_PASS ?? ''

type Slave = {
  modular?: { slot_index_increment: number; modules: Array<{ slot: number; ident: string }> }
  mandatory_pdos?: string[]
  sdo_configurations: Array<{ index: string; complete_access?: boolean; value_bytes?: string }>
  tx_pdos: Array<{ index: string; fixed?: boolean }>
}

test('a modular station built against a connected runtime writes the EtherDOG files', async () => {
  test.skip(HOST === '' || USER === '' || PASS === '', 'set E2E_RUNTIME_HOST, E2E_RUNTIME_USER and E2E_RUNTIME_PASS')
  test.setTimeout(300000)
  const { project, userData } = writeEthercatProject(
    join(tmpdir(), 'openplc-e2e-ethercat-connected'),
    HOST,
    UR20_STATION,
  )
  const { app, page } = await launch(userData)
  try {
    await page.getByText(PROJECT_NAME, { exact: true }).first().click({ timeout: 30000 })
    await connectRuntime(page, USER, PASS)

    await buildFromMenu(page, 'Build and upload')

    const build = join(project, 'build')
    await expect(page.getByText('Upload complete.').first()).toBeVisible({ timeout: 240000 })
    await expect(page.getByText(/Build refused/)).toHaveCount(0)
    await expect(page.getByText(/requires EtherDOG/)).toHaveCount(0)
    expect(findFile(build, 'ethercat.json')).toBeUndefined()

    const busconfig: Array<{ name: string; config: { slaves: Slave[] } }> = JSON.parse(
      readFileSync(findFile(build, 'ethercat_busconfig.json') ?? '', 'utf-8'),
    )
    const slave = busconfig[0]?.config.slaves[0]
    expect(busconfig[0]?.name).toBe('bus_a')
    expect(slave?.modular?.slot_index_increment).toBe(16)
    expect(slave?.modular?.modules.map((m) => [m.slot, m.ident])).toEqual([
      [1, '0x00091F84'],
      [2, '0x01012FA0'],
      [4, '0x040115C4'],
    ])
    expect(slave?.mandatory_pdos).toContain('0x1AFF')
    expect(slave?.tx_pdos.every((p) => p.fixed === true)).toBe(true)
    expect(slave?.sdo_configurations.find((s) => s.index === '0xF030')).toMatchObject({
      complete_access: true,
      value_bytes: '0x0400841F0900A02F010100000000C4150104',
    })

    const iomapping = readFileSync(findFile(build, 'ethercat_iomapping.json') ?? '', 'utf-8')
    expect(iomapping).toContain('%IX2.0')
    expect(iomapping).toContain('%QX2.0')
    const program = readFileSync(findFile(build, 'program.st') ?? '', 'utf-8')
    expect(program).toMatch(/do1\s+AT\s+%QX2\.0/i)
  } finally {
    await quitApp(app, page)
  }
})
