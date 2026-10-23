/**
 * An EtherCAT modular station (UR20 coupler, modules in slots 1, 2 and 4) builds with no runtime
 * connected: the capability gate warns about the EtherDOG version instead of refusing, and the
 * program is compiled.
 *
 * Needs a production build plus the preload copy; see "Electron e2e" in CLAUDE.md.
 */
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import {
  buildFromMenu,
  findFile,
  launch,
  PROJECT_NAME,
  quitApp,
  UR20_STATION,
  writeEthercatProject,
} from './helpers/ethercat-project'

test('a modular station builds offline with a warning naming the EtherDOG version', async () => {
  test.setTimeout(300000)
  const { project, userData } = writeEthercatProject(join(tmpdir(), 'openplc-e2e-ethercat-offline'), '', UR20_STATION)
  const { app, page } = await launch(userData)
  try {
    await page.getByText(PROJECT_NAME, { exact: true }).first().click({ timeout: 30000 })
    await buildFromMenu(page, 'Build only')

    await expect(page.getByText(/requires EtherDOG 1\.0\.0 or newer/).first()).toBeVisible({ timeout: 60000 })
    await expect(page.getByText(/Build refused/)).toHaveCount(0)

    const build = join(project, 'build')
    await expect.poll(() => findFile(build, 'program.st') !== undefined, { timeout: 180000 }).toBe(true)
    const program = readFileSync(findFile(build, 'program.st') ?? '', 'utf-8')
    expect(program).toMatch(/di1\s+AT\s+%IX2\.0/i)
    expect(program).toMatch(/do1\s+AT\s+%QX2\.0/i)
  } finally {
    await quitApp(app, page)
  }
})
