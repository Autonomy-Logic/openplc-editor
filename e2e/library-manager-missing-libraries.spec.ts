import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ElectronApplication, Page } from '@playwright/test'
import { _electron as electron, expect, test } from '@playwright/test'

const ROOT = join(realpathSync(tmpdir()), 'openplc-e2e-missing-libraries')
const PROJECT_NAME = 'missing-libraries'

type LibraryRef = { name: string; version: string }
type Paths = { project: string; userData: string }

const GHOST = { name: 'ghost-lib', version: '1.0.0' }
const OTHER_GHOST = { name: 'other-ghost', version: '2.0.0' }

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
})
