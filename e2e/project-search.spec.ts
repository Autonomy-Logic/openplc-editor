/**
 * DOPE-746 - Search in Project lists every occurrence, and the count matches the rows.
 *
 * The reported failure was a header reading "3 matches" above a single row, with graphical
 * bodies never scanned at all. This suite searches a project whose ST body uses one variable
 * on three lines and whose ladder POU uses it on a contact, then opens one occurrence of each
 * kind and checks where the editor landed.
 *
 * Needs a production build plus the preload at the path a non-packaged app looks for it; see
 * "Electron e2e" in CLAUDE.md.
 */
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ElectronApplication, Page } from '@playwright/test'
import { _electron as electron, expect, test } from '@playwright/test'

const ROOT = join(tmpdir(), 'openplc-e2e-project-search')
const PROJECT_NAME = 'project-search'

const PROGRAM = `PROGRAM main
  VAR
    Motor : BOOL;
    Lamp : BOOL;
    xMOTOR_ON : BOOL;
  END_VAR

Motor := TRUE;
IF Motor THEN
  Lamp := xMOTOR_ON;
END_IF;
Motor := Lamp AND xMOTOR_ON;

END_PROGRAM
`

function writeFixture(): { project: string; userData: string } {
  const project = join(ROOT, 'project')
  const userData = join(ROOT, 'userdata')
  rmSync(ROOT, { recursive: true, force: true })
  mkdirSync(join(project, 'pous', 'programs'), { recursive: true })
  mkdirSync(join(project, 'devices', 'servers'), { recursive: true })
  mkdirSync(join(project, 'devices', 'remote'), { recursive: true })

  writeFileSync(
    join(project, 'project.json'),
    JSON.stringify({
      meta: { name: PROJECT_NAME, type: 'plc-project' },
      data: {
        dataTypes: [],
        pous: [],
        configuration: {
          resource: {
            tasks: [{ name: 'task0', triggering: 'Cyclic', interval: 'T#20ms', priority: 1 }],
            instances: [{ name: 'instance0', program: 'main', task: 'task0' }],
            globalVariables: [
              {
                name: 'MotorGlobal',
                class: 'global',
                type: { definition: 'base-type', value: 'BOOL' },
                location: '',
                documentation: '',
              },
            ],
          },
        },
        libraries: [],
        debugVariables: { global: [], pous: {} },
      },
    }),
  )
  writeFileSync(
    join(project, 'devices', 'configuration.json'),
    JSON.stringify({
      deviceBoard: 'OpenPLC Runtime v4',
      communicationPort: '',
      runtimeIpAddress: '192.168.1.50',
      selectedPlatformOptions: {},
    }),
  )
  writeFileSync(join(project, 'devices', 'pin-mapping.json'), '{}')
  writeFileSync(join(project, 'pous', 'programs', 'main.st'), PROGRAM)
  copyFileSync(
    join(__dirname, 'fixtures', 'project-search', 'motor_ladder.ld'),
    join(project, 'pous', 'programs', 'motor_ladder.ld'),
  )

  const history = join(userData, 'User', 'History')
  mkdirSync(history, { recursive: true })
  writeFileSync(
    join(history, 'projects.json'),
    JSON.stringify([
      {
        name: PROJECT_NAME,
        path: project,
        projectFilePath: join(project, 'project.json'),
        createdAt: new Date().toISOString(),
        lastOpenedAt: new Date().toISOString(),
      },
    ]),
  )
  writeFileSync(join(history, 'libraries.json'), '[]')

  const runtime = join(userData, 'User', 'Runtime')
  mkdirSync(runtime, { recursive: true })
  writeFileSync(join(runtime, 'arduino-core-control.json'), '[]')
  writeFileSync(join(runtime, 'arduino-library-control.json'), '[]')
  return { project, userData }
}

async function launch(userData: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [join(__dirname, '..', 'release', 'app', 'dist', 'main', 'main.js'), `--user-data-dir=${userData}`],
    env: { ...process.env, NODE_ENV: 'production' },
  })
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    for (const w of app.windows()) {
      try {
        if (w.url().includes('index.html')) {
          await w.waitForLoadState('domcontentloaded')
          return { app, page: w }
        }
      } catch {
        /* window is closing; skip it */
      }
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('main window never appeared')
}

async function search(page: Page, query: string): Promise<void> {
  await page.getByRole('button', { name: 'Search' }).click({ timeout: 30000 })
  await page.getByPlaceholder('Search').fill(query)
  await page.getByPlaceholder('Search').blur()
  await page.getByRole('button', { name: 'Find', exact: true }).click()
}

test('every occurrence is listed, counted and reachable', async () => {
  const { userData } = writeFixture()
  const { app, page } = await launch(userData)
  const electronProcess = app.process()

  try {
    await page.getByText(PROJECT_NAME, { exact: true }).first().click({ timeout: 30000 })
    await page.getByText('main', { exact: true }).first().waitFor({ timeout: 30000 })

    await search(page, 'Motor')

    const rows = page.locator('li[aria-selected]')
    await rows.first().waitFor({ timeout: 15000 })

    const header = await page.getByText(/ - \d+ matches/).innerText()
    const counted = Number(/ - (\d+) matches/.exec(header)?.[1])
    expect(counted).toBe(await rows.count())
    expect(counted).toBeGreaterThan(3)

    // Lines are the POU body's own, as the editor shows it: the VAR header is not part of it.
    await expect(page.getByText('Line 1: Motor := TRUE;')).toBeVisible()
    await expect(page.getByText('Line 2: IF Motor THEN')).toBeVisible()
    expect(await page.getByText('Line 5: Motor := Lamp AND xMOTOR_ON;').count()).toBe(2)
    await expect(page.getByText('Motor drives the lamp')).toBeVisible()
    await expect(page.getByText('MotorGlobal', { exact: true })).toBeVisible()

    await page.screenshot({ path: join(ROOT, 'search-results.png'), fullPage: true })

    await page.getByText('Line 2: IF Motor THEN').click()
    await expect(page.locator('.view-lines:visible')).toContainText('IF Motor THEN')

    // The ladder occurrence sits on a contact, so opening it selects that node on the canvas.
    const ladderGroup = page.locator('li[aria-expanded]').filter({ hasText: 'motor_ladder' })
    await ladderGroup.locator('li[aria-selected]').filter({ hasText: 'Motor' }).last().click()
    await expect(page.locator('.react-flow__node.selected')).toContainText('Motor', { timeout: 15000 })
    await page.screenshot({ path: join(ROOT, 'search-ladder.png'), fullPage: true })
  } finally {
    await Promise.race([app.close().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 15000))])
    if (electronProcess.exitCode === null) electronProcess.kill('SIGKILL')
  }
})
