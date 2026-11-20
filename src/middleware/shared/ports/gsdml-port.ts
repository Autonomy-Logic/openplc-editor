import type { DescriptionItem } from './device-description-repository'
import type { GsdmlRepositorySummary } from './gsdml-repository-mechanisms'
import type { GsdmlCatalog } from './gsdml-types'
import type { Result } from './types'

/** One stored GSDML file as the UI sees it: its summary plus the row's identity. */
export type GsdmlRepositoryItem = DescriptionItem<GsdmlRepositorySummary>

/**
 * Repository of GSDML (PROFINET device description) files and access to the catalog of each.
 *
 * Every platform uses the same implementation, `createGsdmlRepositoryPort`
 * (`backend/shared/profinet/gsdml-repository-port.ts`). Platforms only supply
 * mechanisms (`gsdml-repository-mechanisms.ts`): where the shared parser runs and
 * where rows are stored.
 */
export interface GsdmlPort {
  /**
   * Lists the stored items. Rows stored by another summary version are parsed again
   * and stored with the current one; a row that cannot be parsed again is left out.
   */
  loadRepository(): Promise<Result<{ items: GsdmlRepositoryItem[] }>>

  /**
   * Parses a GSDML file and stores it as a new item.
   *
   * @param filename The file's name.
   * @param content The file's text.
   * @returns The new item; `duplicate: true` and no item when identical content (SHA-256) is
   *   already stored, whatever its filename; or the parser's reason when the file is rejected.
   */
  importFile(filename: string, content: string): Promise<Result<{ item?: GsdmlRepositoryItem; duplicate?: boolean }>>

  /** Removes one item and its XML. */
  removeItem(itemId: string): Promise<Result>

  /** Removes every item. */
  clearRepository(): Promise<Result>

  /**
   * Returns the catalog of a stored item, parsed from its XML.
   *
   * The catalog is shared with the port's cache and must not be modified.
   *
   * @param itemId The id of the item.
   * @returns The catalog, or the read or parse error.
   */
  loadCatalog(itemId: string): Promise<Result<{ catalog: GsdmlCatalog }>>
}
