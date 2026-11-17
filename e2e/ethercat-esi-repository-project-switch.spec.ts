import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type ElectronApplication, expect, type Page, test } from '@playwright/test'

import {
  EK1818_STATION,
  INTERPOLATION_DRIVE_STATION,
  launch,
  PROJECT_NAME,
  quitApp,
  writeEthercatProject,
} from './helpers/ethercat-project'

const DRIVE_B_XML = readFileSync(
  join(__dirname, 'fixtures', 'ethercat-defaultdata', '11111111-2222-4333-8444-555555555555.xml'),
  'utf-8',
)
  .replace('Test Drive Vendor', 'Second Vendor')
  .replace('#x00005100', '#x00005200')

/** The project's `devices/esi` folder as stored on disk: the index filenames and the XML files, sorted. */
function storedEsi(esiDir: string): { filenames: string[]; xmlFiles: string[] } {
  const indexPath = join(esiDir, 'repository.json')
  const index: { items: Array<{ filename: string }> } = existsSync(indexPath)
    ? JSON.parse(readFileSync(indexPath, 'utf-8'))
    : { items: [] }
  return {
    filenames: index.items.map((item) => item.filename).sort(),
    xmlFiles: existsSync(esiDir)
      ? readdirSync(esiDir)
          .filter((name) => name.endsWith('.xml'))
          .sort()
      : [],
  }
}

/** Filenames of the rows the repository table shows, sorted. */
async function shownFilenames(page: Page): Promise<string[]> {
  const rows = page.getByTestId('esi-repository-row')
  const names = await rows.evaluateAll((elements) => elements.map((e) => e.getAttribute('data-filename') ?? ''))
  return names.sort()
}

/** Opens the project at @p projectPath the way File > Open Recent does. */
async function openRecent(app: ElectronApplication, projectPath: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }, path) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'))
    win?.webContents.send('project:open-recent-accelerator', path)
  }, projectPath)
}

/** Opens the bus editor of the open project on its Repository tab. */
async function openRepositoryTab(page: Page): Promise<void> {
  await page.getByText('ecat_bus', { exact: true }).first().dblclick({ timeout: 60000 })
  await page.getByTestId('ethercat-tab-repository').click({ timeout: 60000 })
}

test('the repository list follows the open project', async () => {
  test.setTimeout(180000)
  const base = join(realpathSync(tmpdir()), `openplc-e2e-esi-project-switch-${test.info().repeatEachIndex}`)
  const first = writeEthercatProject(join(base, 'first'), '', INTERPOLATION_DRIVE_STATION)
  const second = writeEthercatProject(join(base, 'second'), '', EK1818_STATION)
  const uploads = join(base, 'uploads')
  mkdirSync(uploads, { recursive: true })
  writeFileSync(join(uploads, 'drive-b.xml'), DRIVE_B_XML)
  const firstEsi = join(first.project, 'devices', 'esi')
  const secondEsi = join(second.project, 'devices', 'esi')
  const firstStored = storedEsi(firstEsi)
  expect(firstStored.filenames).toEqual(['interpolation-drive.xml'])

  const { app, page } = await launch(first.userData)
  try {
    await page.getByText(PROJECT_NAME, { exact: true }).first().click({ timeout: 30000 })
    await openRepositoryTab(page)
    await expect(page.getByTestId('esi-repository-row')).toHaveCount(1, { timeout: 30000 })
    expect(await shownFilenames(page)).toEqual(['interpolation-drive.xml'])

    await openRecent(app, second.project)
    await openRepositoryTab(page)
    await expect(page.getByTestId('esi-repository-empty')).toBeVisible({ timeout: 30000 })
    await expect(page.getByTestId('esi-repository-row')).toHaveCount(0)

    await page.getByTestId('esi-upload-input').setInputFiles(join(uploads, 'drive-b.xml'))
    await expect(page.getByTestId('esi-repository-row')).toHaveCount(1, { timeout: 30000 })
    expect(await shownFilenames(page)).toEqual(['drive-b.xml'])
    const secondStored = storedEsi(secondEsi)
    expect(secondStored.filenames).toEqual(['drive-b.xml'])
    expect(secondStored.xmlFiles).toHaveLength(1)
    expect(storedEsi(firstEsi)).toEqual(firstStored)

    await openRecent(app, first.project)
    await openRepositoryTab(page)
    await expect(
      page.locator('[data-testid="esi-repository-row"][data-filename="interpolation-drive.xml"]'),
    ).toHaveCount(1, { timeout: 30000 })
    await expect(page.getByTestId('esi-repository-row')).toHaveCount(1)
    expect(storedEsi(firstEsi)).toEqual(firstStored)
    expect(storedEsi(secondEsi)).toEqual(secondStored)
  } finally {
    await quitApp(app, page)
  }
})
