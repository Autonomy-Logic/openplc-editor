import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Locator, Page } from '@playwright/test'

/** Text of the synthetic drive ESI in e2e/fixtures/ethercat-defaultdata. */
export const DRIVE_ESI_XML = readFileSync(
  join(__dirname, '..', 'fixtures', 'ethercat-defaultdata', '11111111-2222-4333-8444-555555555555.xml'),
  'utf-8',
)

/** {@link DRIVE_ESI_XML} with @p vendorName as its vendor and @p productCode as its product code. */
export function driveEsiVariant(vendorName: string, productCode: string): string {
  return DRIVE_ESI_XML.replace('Test Drive Vendor', vendorName).replace('#x00005100', productCode)
}

/** The project's ESI folder as stored on disk: the index rows and the XML files beside it. */
export interface StoredEsi {
  rows: Array<{ id: string; filename: string }>
  xmlFiles: string[]
}

/** The rows of a parsed `repository.json`, reduced to id and filename; throws when it is not an ESI index. */
function indexRows(index: unknown, indexPath: string): StoredEsi['rows'] {
  if (typeof index !== 'object' || index === null || !('items' in index) || !Array.isArray(index.items)) {
    throw new Error(`${indexPath} has no items array`)
  }
  return index.items.map((item: unknown) => {
    if (
      typeof item !== 'object' ||
      item === null ||
      !('id' in item) ||
      !('filename' in item) ||
      typeof item.id !== 'string' ||
      typeof item.filename !== 'string'
    ) {
      throw new Error(`${indexPath} has an item without a string id and filename`)
    }
    return { id: item.id, filename: item.filename }
  })
}

/** Reads `devices/esi` of the project; a missing folder or index reads as empty. */
export function readStoredEsi(esiDir: string): StoredEsi {
  if (!existsSync(esiDir)) return { rows: [], xmlFiles: [] }
  const indexPath = join(esiDir, 'repository.json')
  const index: unknown = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf-8')) : { items: [] }
  return {
    rows: indexRows(index, indexPath),
    xmlFiles: readdirSync(esiDir)
      .filter((name) => name.endsWith('.xml'))
      .sort(),
  }
}

/** Filenames of the stored rows, sorted. */
export function storedFilenames(esiDir: string): string[] {
  return readStoredEsi(esiDir)
    .rows.map((row) => row.filename)
    .sort()
}

/** The repository table row of the file named @p filename. */
export function repositoryRow(page: Page, filename: string): Locator {
  return page.locator(`[data-testid="esi-repository-row"][data-filename="${filename}"]`)
}

/** Filenames of the rows the repository table shows, sorted. */
export async function shownFilenames(page: Page): Promise<string[]> {
  const rows = page.getByTestId('esi-repository-row')
  const names = await rows.evaluateAll((elements) => elements.map((e) => e.getAttribute('data-filename') ?? ''))
  return names.sort()
}

/** Opens the bus editor of the open project on its Repository tab. */
export async function openRepositoryTab(page: Page): Promise<void> {
  await page.getByText('ecat_bus', { exact: true }).first().dblclick({ timeout: 60000 })
  await page.getByTestId('ethercat-tab-repository').click({ timeout: 60000 })
}
