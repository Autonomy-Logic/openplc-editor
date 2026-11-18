import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import {
  DRIVE_ESI_XML,
  driveEsiVariant,
  openRepositoryTab,
  readStoredEsi,
  repositoryRow,
  shownFilenames,
  storedFilenames,
} from './helpers/esi-repository'
import { EK1818_STATION, launch, PROJECT_NAME, quitApp, writeEthercatProject } from './helpers/ethercat-project'

/** ESI files the test imports, by name; the copy has the same content as drive-a.xml. */
const ESI_FILES: Record<string, string> = {
  'drive-a.xml': DRIVE_ESI_XML,
  'drive-a-copy.xml': DRIVE_ESI_XML,
  'drive-b.xml': driveEsiVariant('Second Vendor', '#x00005200'),
  'drive-c.xml': driveEsiVariant('Third Vendor', '#x00005300'),
  'broken.xml': '<EtherCATInfo><Vendor>',
}

/** Asserts every stored row has its `<id>.xml` file and no other XML file is in the folder. */
function expectOneXmlPerRow(esiDir: string): void {
  const { rows, xmlFiles } = readStoredEsi(esiDir)
  expect(xmlFiles).toEqual(rows.map((row) => `${row.id}.xml`).sort())
}

test('ESI files are imported once, rejected when malformed, removed and cleared', async () => {
  test.setTimeout(180000)
  const root = join(realpathSync(tmpdir()), `openplc-e2e-esi-repository-${test.info().repeatEachIndex}`)
  const { project, userData } = writeEthercatProject(root, '', EK1818_STATION)
  const uploads = join(root, 'uploads')
  mkdirSync(uploads, { recursive: true })
  for (const [name, text] of Object.entries(ESI_FILES)) writeFileSync(join(uploads, name), text)
  const esiDir = join(project, 'devices', 'esi')

  const { app, page } = await launch(userData)
  try {
    await page.getByText(PROJECT_NAME, { exact: true }).first().click({ timeout: 30000 })
    await openRepositoryTab(page)
    await expect(page.getByTestId('esi-repository-empty')).toBeVisible({ timeout: 30000 })
    expect(storedFilenames(esiDir)).toEqual([])
    const input = page.getByTestId('esi-upload-input')

    await input.setInputFiles([join(uploads, 'drive-a.xml'), join(uploads, 'drive-b.xml')])
    await expect(page.getByTestId('esi-repository-row')).toHaveCount(2, { timeout: 30000 })
    await expect(page.getByTestId('esi-repository-count')).toHaveText('Loaded Files (2) - 2 device(s)')
    expect(await shownFilenames(page)).toEqual(['drive-a.xml', 'drive-b.xml'])
    expect(storedFilenames(esiDir)).toEqual(['drive-a.xml', 'drive-b.xml'])
    expectOneXmlPerRow(esiDir)
    const driveA = readStoredEsi(esiDir).rows.find((row) => row.filename === 'drive-a.xml')
    expect(readFileSync(join(esiDir, `${driveA?.id}.xml`), 'utf-8')).toBe(DRIVE_ESI_XML)
    await expect(page.getByTestId('esi-upload-errors')).toHaveCount(0)

    await input.setInputFiles([join(uploads, 'drive-a-copy.xml'), join(uploads, 'drive-c.xml')])
    await expect(page.getByTestId('esi-repository-row')).toHaveCount(3, { timeout: 30000 })
    expect(await shownFilenames(page)).toEqual(['drive-a.xml', 'drive-b.xml', 'drive-c.xml'])
    await expect(repositoryRow(page, 'drive-a-copy.xml')).toHaveCount(0)
    expect(storedFilenames(esiDir)).toEqual(['drive-a.xml', 'drive-b.xml', 'drive-c.xml'])
    expectOneXmlPerRow(esiDir)
    await expect(page.getByTestId('esi-upload-errors')).toHaveCount(0)

    await input.setInputFiles(join(uploads, 'broken.xml'))
    await expect(page.getByTestId('esi-upload-errors')).toContainText('1 file(s) failed to parse', { timeout: 30000 })
    await expect(page.getByTestId('esi-repository-row')).toHaveCount(3)
    await expect(repositoryRow(page, 'broken.xml')).toHaveCount(0)
    expect(storedFilenames(esiDir)).toEqual(['drive-a.xml', 'drive-b.xml', 'drive-c.xml'])
    expectOneXmlPerRow(esiDir)

    const removedId = readStoredEsi(esiDir).rows.find((row) => row.filename === 'drive-a.xml')?.id
    await repositoryRow(page, 'drive-a.xml').getByTestId('esi-repository-remove').click()
    await expect(page.getByTestId('esi-repository-row')).toHaveCount(2, { timeout: 30000 })
    expect(await shownFilenames(page)).toEqual(['drive-b.xml', 'drive-c.xml'])
    await expect(page.getByTestId('esi-repository-count')).toHaveText('Loaded Files (2) - 2 device(s)')
    expect(storedFilenames(esiDir)).toEqual(['drive-b.xml', 'drive-c.xml'])
    expectOneXmlPerRow(esiDir)
    expect(existsSync(join(esiDir, `${removedId}.xml`))).toBe(false)

    await page.getByTestId('esi-repository-clear-all').click()
    await expect(page.getByTestId('esi-repository-empty')).toBeVisible({ timeout: 30000 })
    await expect(page.getByTestId('esi-repository-row')).toHaveCount(0)
    await expect(page.getByTestId('esi-upload-errors')).toHaveCount(0)
    expect(readStoredEsi(esiDir)).toEqual({ rows: [], xmlFiles: [] })
  } finally {
    await quitApp(app, page)
  }
})
