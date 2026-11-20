import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { sendToMainWindow } from './helpers/electron-editor'
import {
  driveEsiVariant,
  openRepositoryTab,
  readStoredEsi,
  repositoryRow,
  shownFilenames,
  storedFilenames,
} from './helpers/esi-repository'
import {
  EK1818_STATION,
  INTERPOLATION_DRIVE_STATION,
  launch,
  PROJECT_NAME,
  quitApp,
  writeEthercatProject,
} from './helpers/ethercat-project'

test('the repository list follows the open project', async () => {
  test.setTimeout(180000)
  const base = join(realpathSync(tmpdir()), `openplc-e2e-esi-project-switch-${test.info().repeatEachIndex}`)
  const first = writeEthercatProject(join(base, 'first'), '', INTERPOLATION_DRIVE_STATION)
  const second = writeEthercatProject(join(base, 'second'), '', EK1818_STATION)
  const uploads = join(base, 'uploads')
  mkdirSync(uploads, { recursive: true })
  writeFileSync(join(uploads, 'drive-b.xml'), driveEsiVariant('Second Vendor', '#x00005200'))
  const firstEsi = join(first.project, 'devices', 'esi')
  const secondEsi = join(second.project, 'devices', 'esi')
  const firstStored = readStoredEsi(firstEsi)
  expect(storedFilenames(firstEsi)).toEqual(['interpolation-drive.xml'])

  const { app, page } = await launch(first.userData)
  try {
    await page.getByText(PROJECT_NAME, { exact: true }).first().click({ timeout: 30000 })
    await openRepositoryTab(page)
    await expect(page.getByTestId('esi-repository-row')).toHaveCount(1, { timeout: 30000 })
    expect(await shownFilenames(page)).toEqual(['interpolation-drive.xml'])

    await sendToMainWindow(app, 'project:open-recent-accelerator', second.project)
    await openRepositoryTab(page)
    await expect(page.getByTestId('esi-repository-empty')).toBeVisible({ timeout: 30000 })
    await expect(page.getByTestId('esi-repository-row')).toHaveCount(0)

    await page.getByTestId('esi-upload-input').setInputFiles(join(uploads, 'drive-b.xml'))
    await expect(page.getByTestId('esi-repository-row')).toHaveCount(1, { timeout: 30000 })
    expect(await shownFilenames(page)).toEqual(['drive-b.xml'])
    const secondStored = readStoredEsi(secondEsi)
    expect(storedFilenames(secondEsi)).toEqual(['drive-b.xml'])
    expect(secondStored.xmlFiles).toHaveLength(1)
    expect(readStoredEsi(firstEsi)).toEqual(firstStored)

    await sendToMainWindow(app, 'project:open-recent-accelerator', first.project)
    await openRepositoryTab(page)
    await expect(repositoryRow(page, 'interpolation-drive.xml')).toHaveCount(1, { timeout: 30000 })
    await expect(page.getByTestId('esi-repository-row')).toHaveCount(1)
    expect(readStoredEsi(firstEsi)).toEqual(firstStored)
    expect(readStoredEsi(secondEsi)).toEqual(secondStored)
  } finally {
    await quitApp(app, page)
  }
})
