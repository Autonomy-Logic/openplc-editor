import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ElectronApplication, Locator, Page } from '@playwright/test'
import { _electron as electron, expect, test } from '@playwright/test'

const ROOT = join(realpathSync(tmpdir()), 'openplc-e2e-missing-libraries')
const PROJECT_NAME = 'missing-libraries'

type LibraryRef = { name: string; version: string }
type Paths = { project: string; userData: string }

const GHOST = { name: 'ghost-lib', version: '1.0.0' }
const OTHER_GHOST = { name: 'other-ghost', version: '2.0.0' }
const MANY_MISSING = Array.from({ length: 30 }, (_, i) => ({
  name: `ghost-${String(i).padStart(2, '0')}`,
  version: '1.0.0',
}))
const HINT = 'Install them on the System Libraries tab, or remove them from this project.'

function writeFixture(slug: string, libraries: LibraryRef[]): Paths {
  const root = join(ROOT, slug)
  const project = join(root, 'project')
  const userData = join(root, 'userdata')
  rmSync(root, { recursive: true, force: true })
  mkdirSync(join(project, 'pous', 'programs'), { recursive: true })
  mkdirSync(join(project, 'devices'), { recursive: true })
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
            globalVariables: [],
          },
        },
        libraries,
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
  writeFileSync(
    join(project, 'pous', 'programs', 'main.st'),
    'PROGRAM main\n  VAR\n    counter : INT;\n  END_VAR\n\ncounter := counter + 1;\n\nEND_PROGRAM\n',
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

async function launch({ userData }: Paths): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [join(__dirname, '..', 'release', 'app', 'dist', 'main', 'main.js'), `--user-data-dir=${userData}`],
    env: { ...process.env, NODE_ENV: 'production' },
  })
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    for (const w of app.windows()) {
      if (!w.isClosed() && w.url().includes('index.html')) {
        await w.waitForLoadState('domcontentloaded')
        return { app, page: w }
      }
    }
    await app.waitForEvent('window', { timeout: 1000 }).catch(() => undefined)
  }
  await app.close()
  throw new Error('main window never appeared')
}

const save = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'))
    win?.webContents.send('project:save-accelerator')
  })

function savedLibraries({ project }: Paths): unknown {
  const parsed: unknown = JSON.parse(readFileSync(join(project, 'project.json'), 'utf-8'))
  if (typeof parsed !== 'object' || parsed === null || !('data' in parsed)) return undefined
  const { data } = parsed
  if (typeof data !== 'object' || data === null || !('libraries' in data)) return undefined
  return data.libraries
}

async function openProject(page: Page): Promise<void> {
  await page.getByText(PROJECT_NAME, { exact: true }).first().click({ timeout: 30000 })
}

async function openProjectLibrariesFromMissingModal(page: Page): Promise<void> {
  await openProject(page)
  await page.getByRole('dialog').getByRole('button', { name: 'Open Library Manager' }).click({ timeout: 30000 })
  await page.getByRole('tab', { name: 'Project Libraries' }).click()
}

async function withApp(paths: Paths, run: (app: ElectronApplication, page: Page) => Promise<void>): Promise<void> {
  const { app, page } = await launch(paths)
  try {
    await run(app, page)
  } finally {
    app.process().kill('SIGKILL')
  }
}

async function isHittable(target: Locator): Promise<boolean> {
  return target.evaluate((el) => {
    const box = el.getBoundingClientRect()
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
    return hit !== null && el.contains(hit)
  })
}

async function centreOf(target: Locator): Promise<{ x: number; y: number }> {
  const box = await target.boundingBox()
  if (!box) throw new Error('the target has no bounding box')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

async function wheelUntilHittable(page: Page, at: { x: number; y: number }, target: Locator): Promise<void> {
  await page.mouse.move(at.x, at.y)
  for (let step = 0; step < 40 && !(await isHittable(target)); step += 1) {
    const before = await target.evaluate((el) => el.getBoundingClientRect().y)
    await page.mouse.wheel(0, 20)
    await expect.poll(() => target.evaluate((el) => el.getBoundingClientRect().y)).not.toBe(before)
  }
  expect(await isHittable(target)).toBe(true)
}

test.describe('Library Manager, missing libraries callout', () => {
  test.setTimeout(120000)

  test('removes the clicked missing library from the project and keeps the other reference', async () => {
    const paths = writeFixture('remove-one', [GHOST, OTHER_GHOST])
    await withApp(paths, async (app, page) => {
      await openProjectLibrariesFromMissingModal(page)

      await expect(page.getByTestId('missing-libraries-callout')).toBeVisible()
      await expect(page.getByTestId('missing-library-row-ghost-lib')).toContainText('ghost-lib (v1.0.0)')
      await expect(page.getByTestId('missing-library-row-other-ghost')).toContainText('other-ghost (v2.0.0)')
      await expect(page.getByTestId('missing-library-remove-ghost-lib')).toHaveAccessibleName(
        'Remove ghost-lib from project',
      )
      await expect(page.getByTestId('missing-library-remove-other-ghost')).toHaveAccessibleName(
        'Remove other-ghost from project',
      )

      await page.getByTestId('missing-library-remove-ghost-lib').click()

      await expect(page.getByTestId('missing-library-row-ghost-lib')).toHaveCount(0)
      await expect(page.getByTestId('missing-library-row-other-ghost')).toBeVisible()

      await save(app)
      await expect.poll(() => savedLibraries(paths), { timeout: 15000 }).toEqual([OTHER_GHOST])
    })
  })

  test('hides the callout once the last missing library is removed', async () => {
    const paths = writeFixture('remove-all', [GHOST, OTHER_GHOST])
    await withApp(paths, async (app, page) => {
      await openProjectLibrariesFromMissingModal(page)

      await page.getByTestId('missing-library-remove-ghost-lib').click()
      await expect(page.getByTestId('missing-library-row-ghost-lib')).toHaveCount(0)
      await expect(page.getByTestId('missing-libraries-callout')).toBeVisible()

      await page.getByTestId('missing-library-remove-other-ghost').click()

      await expect(page.getByTestId('missing-libraries-callout')).toHaveCount(0)
      await save(app)
      await expect.poll(() => savedLibraries(paths), { timeout: 15000 }).toEqual([])
    })
  })

  test('a saved project reopens without the removed library', async () => {
    const paths = writeFixture('reopen', [GHOST])
    await withApp(paths, async (app, page) => {
      await openProjectLibrariesFromMissingModal(page)
      await page.getByTestId('missing-library-remove-ghost-lib').click()
      await expect(page.getByTestId('missing-libraries-callout')).toHaveCount(0)
      await save(app)
      await expect.poll(() => savedLibraries(paths), { timeout: 15000 }).toEqual([])
    })

    await withApp(paths, async (_app, page) => {
      await openProject(page)
      await page.getByRole('button', { name: 'Manage libraries…' }).click({ timeout: 30000 })
      await page.getByRole('tab', { name: 'Project Libraries' }).click()

      await expect(page.getByRole('tab', { name: 'Project Libraries' })).toHaveAttribute('data-state', 'active')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.getByTestId('missing-libraries-callout')).toHaveCount(0)
    })
  })

  test('every missing library and the hint can be reached with the mouse wheel in the default window', async () => {
    const paths = writeFixture('reach-many', MANY_MISSING)
    await withApp(paths, async (_app, page) => {
      await openProjectLibrariesFromMissingModal(page)

      const callout = page.getByTestId('missing-libraries-callout')
      const list = page.getByTestId('missing-libraries-list')
      const lastRemove = page.getByTestId('missing-library-remove-ghost-29')
      const firstRemove = page.getByTestId('missing-library-remove-ghost-00')
      const hint = callout.getByText(HINT, { exact: true })
      await expect(list.getByRole('listitem')).toHaveCount(30)
      expect(await isHittable(lastRemove)).toBe(false)

      const calloutBox = await callout.boundingBox()
      const listBox = await list.boundingBox()
      if (!calloutBox || !listBox) throw new Error('the missing libraries callout has no bounding box')
      const label = { x: calloutBox.x + 30, y: calloutBox.y + 10 }
      const overList = { x: listBox.x + listBox.width / 2, y: listBox.y + 10 }

      await page.mouse.move(overList.x, overList.y)
      await page.mouse.wheel(0, 2000)
      await expect.poll(() => list.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(1)

      await wheelUntilHittable(page, label, lastRemove)
      const lastCentre = await centreOf(lastRemove)
      await page.mouse.click(lastCentre.x, lastCentre.y)
      await expect(page.getByTestId('missing-library-row-ghost-29')).toHaveCount(0)
      await expect(list.getByRole('listitem')).toHaveCount(29)

      await wheelUntilHittable(page, label, hint)

      const hintCentre = await centreOf(hint)
      await page.mouse.move(hintCentre.x, hintCentre.y)
      await page.mouse.wheel(0, -2000)
      await expect.poll(async () => (await callout.boundingBox())?.y).toBe(calloutBox.y)
      await page.mouse.move(overList.x, overList.y)
      await page.mouse.wheel(0, -2000)
      await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(0)

      expect(await isHittable(firstRemove)).toBe(true)
      const firstCentre = await centreOf(firstRemove)
      await page.mouse.click(firstCentre.x, firstCentre.y)
      await expect(page.getByTestId('missing-library-row-ghost-00')).toHaveCount(0)
      await expect(list.getByRole('listitem')).toHaveCount(28)
    })
  })
})
