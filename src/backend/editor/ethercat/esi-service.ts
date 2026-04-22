import type { ESIDeviceSummary, ESIRepositoryItemLight } from '@root/middleware/shared/ports/esi-types'
import { promises } from 'fs'
import { basename, dirname, join } from 'path'
import { v4 as uuidv4 } from 'uuid'

import { parseESILight } from '../../shared/ethercat/esi-parser-main'
import { fileOrDirectoryExists } from '../utils'

/**
 * ESI Repository Index stored in devices/esi/repository.json
 * Version 2 includes device summaries inline for instant loading.
 *
 * The in-disk format keeps loadedAt as Unix ms (number) for backward
 * compatibility with existing project files. The shared
 * ESIRepositoryItem{Light} types expose loadedAt as an ISO 8601 string
 * (matching the web backend); conversion happens at every border.
 */
interface ESIRepositoryIndex {
  version: number
  items: Array<{
    id: string
    filename: string
    vendorId: string
    vendorName: string
    deviceCount: number
    loadedAt: number
    warnings?: string[]
    devices?: ESIDeviceSummary[]
  }>
}

/**
 * Convert a loadedAt value coming from the shared types (string, ISO 8601)
 * into the Unix ms format persisted on disk. Tolerates numeric inputs
 * during the transition so nothing breaks if an older caller still passes
 * a number.
 */
function isoToMs(value: string | number): number {
  if (typeof value === 'number') return value
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : Date.now()
}

/**
 * Convert a loadedAt value from the in-disk format (Unix ms) into the
 * ISO 8601 string exposed through the shared types.
 */
function msToIso(value: number): string {
  return new Date(value).toISOString()
}

/**
 * Response type for ESI service operations
 */
interface ESIServiceResponse {
  success: boolean
  error?: string
}

/**
 * ESI Service - Handles persistence of ESI XML files in the project
 *
 * ESI files are stored in the project's devices/esi/ directory.
 * Each XML file is saved with its UUID as filename.
 * A repository.json index file tracks all loaded ESI files.
 */
class ESIService {
  private readonly ESI_DIR = 'devices/esi'
  private readonly REPOSITORY_FILE = 'repository.json'
  private indexLock: Promise<void> = Promise.resolve()

  /**
   * Serialize access to the repository index to prevent race conditions.
   */
  private withIndexLock<T>(fn: () => Promise<T>): Promise<T> {
    const current = this.indexLock
    let resolve: () => void
    this.indexLock = new Promise<void>((r) => (resolve = r))
    return current.then(fn).finally(() => resolve!())
  }

  /**
   * Get the ESI directory path for a project
   */
  private getEsiDir(projectPath: string): string {
    const basePath = basename(projectPath) === 'project.json' ? dirname(projectPath) : projectPath
    return join(basePath, this.ESI_DIR)
  }

  /**
   * Get the repository index file path
   */
  private getRepositoryPath(projectPath: string): string {
    return join(this.getEsiDir(projectPath), this.REPOSITORY_FILE)
  }

  private static readonly UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  /**
   * Get the path for an ESI XML file (validates itemId is a UUID to prevent path traversal)
   */
  private getXmlPath(projectPath: string, itemId: string): string {
    if (!ESIService.UUID_REGEX.test(itemId)) {
      throw new Error(`Invalid item ID: ${itemId}`)
    }
    return join(this.getEsiDir(projectPath), `${itemId}.xml`)
  }

  /**
   * Ensure the ESI directory exists
   */
  private async ensureEsiDir(projectPath: string): Promise<void> {
    const esiDir = this.getEsiDir(projectPath)
    if (!fileOrDirectoryExists(esiDir)) {
      await promises.mkdir(esiDir, { recursive: true })
    }
  }

  /**
   * Load the ESI repository index from disk
   */
  async loadRepositoryIndex(projectPath: string): Promise<ESIRepositoryIndex | null> {
    const repoPath = this.getRepositoryPath(projectPath)

    let content: string
    try {
      content = await promises.readFile(repoPath, 'utf-8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }
      // Re-throw I/O errors (permission, locked file, ...) so callers don't
      // silently overwrite what is probably a working file.
      throw error
    }

    try {
      return JSON.parse(content) as ESIRepositoryIndex
    } catch (parseError) {
      // Corrupted JSON: rename the bad file to `.corrupt-<timestamp>.bak` and
      // treat the repository as empty. This gives callers a clear recovery
      // path (re-parse the XMLs on disk) instead of being stuck with a fatal
      // throw on every load, while preserving the original file for forensics.
      const backupPath = `${repoPath}.corrupt-${Date.now()}.bak`
      try {
        await promises.rename(repoPath, backupPath)
        console.warn(
          `[ESIService] Corrupted repository index at ${repoPath} — backed up to ${backupPath} and treating repository as empty.`,
          parseError,
        )
      } catch (renameError) {
        console.error(
          `[ESIService] Corrupted repository index at ${repoPath} and backup rename failed. Leaving file in place.`,
          { parseError, renameError },
        )
      }
      return null
    }
  }

  /**
   * Save the ESI repository index to disk in v2 format with device summaries
   */
  async saveRepositoryIndexV2(projectPath: string, items: ESIRepositoryItemLight[]): Promise<ESIServiceResponse> {
    try {
      await this.ensureEsiDir(projectPath)

      const index: ESIRepositoryIndex = {
        version: 2,
        items: items.map((item) => ({
          id: item.id,
          filename: item.filename,
          vendorId: item.vendor.id,
          vendorName: item.vendor.name,
          deviceCount: item.devices.length,
          loadedAt: isoToMs(item.loadedAt),
          warnings: item.warnings,
          devices: item.devices,
        })),
      }

      const repoPath = this.getRepositoryPath(projectPath)
      const tmpPath = `${repoPath}.tmp`
      await promises.writeFile(tmpPath, JSON.stringify(index, null, 2), 'utf-8')
      await promises.rename(tmpPath, repoPath)

      return { success: true }
    } catch (error) {
      console.error('Error saving ESI repository index v2:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to save repository index',
      }
    }
  }

  /**
   * Save an ESI XML file to disk
   */
  async saveXmlFile(projectPath: string, itemId: string, xmlContent: string): Promise<ESIServiceResponse> {
    try {
      await this.ensureEsiDir(projectPath)

      const xmlPath = this.getXmlPath(projectPath, itemId)
      await promises.writeFile(xmlPath, xmlContent, 'utf-8')

      return { success: true }
    } catch (error) {
      console.error('Error saving ESI XML file:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to save XML file',
      }
    }
  }

  /**
   * Load an ESI XML file from disk
   */
  async loadXmlFile(
    projectPath: string,
    itemId: string,
  ): Promise<{ success: boolean; content?: string; error?: string }> {
    try {
      const xmlPath = this.getXmlPath(projectPath, itemId)
      const content = await promises.readFile(xmlPath, 'utf-8')
      return { success: true, content }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { success: false, error: 'XML file not found' }
      }
      console.error('Error loading ESI XML file:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load XML file',
      }
    }
  }

  /**
   * Delete an ESI XML file from disk
   */
  async deleteXmlFile(projectPath: string, itemId: string): Promise<ESIServiceResponse> {
    try {
      const xmlPath = this.getXmlPath(projectPath, itemId)
      await promises.unlink(xmlPath)
      return { success: true }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { success: true } // already deleted
      }
      console.error('Error deleting ESI XML file:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete XML file',
      }
    }
  }

  /**
   * Delete a repository item and update the v2 index (no re-parsing)
   */
  async deleteRepositoryItemV2(projectPath: string, itemId: string): Promise<ESIServiceResponse> {
    return this.withIndexLock(async () => {
      try {
        // Delete the XML file
        const deleteResult = await this.deleteXmlFile(projectPath, itemId)
        if (!deleteResult.success) {
          return deleteResult
        }

        // Update the v2 index without the deleted item
        const currentItems = await this.loadLightItemsFromIndex(projectPath)
        const updatedItems = currentItems.filter((i) => i.id !== itemId)
        return this.saveRepositoryIndexV2(projectPath, updatedItems)
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to delete repository item',
        }
      }
    })
  }

  /**
   * Load light items from the v2 repository index.
   *
   * Assumes the caller has already confirmed the index is fully v2-shaped
   * (all items carry `devices`). Items missing `devices` are treated as a
   * schema violation — they were already rejected by `loadRepositoryLight`.
   */
  private async loadLightItemsFromIndex(projectPath: string): Promise<ESIRepositoryItemLight[]> {
    const index = await this.loadRepositoryIndex(projectPath)
    if (!index || index.version !== 2) return []
    return index.items.map((i) => ({
      id: i.id,
      filename: i.filename,
      vendor: { id: i.vendorId, name: i.vendorName },
      devices: i.devices ?? [],
      loadedAt: msToIso(i.loadedAt),
      warnings: i.warnings,
    }))
  }

  /**
   * Load repository as lightweight items (v2 instant, v1 needs migration).
   *
   * A v2 index is only considered valid when ALL items carry a `devices`
   * array. If any item is missing it (partial write, manual edit, external
   * corruption), we flag the whole index as needing re-migration so the
   * user's view never silently drops items.
   */
  async loadRepositoryLight(
    projectPath: string,
  ): Promise<{ success: boolean; items?: ESIRepositoryItemLight[]; needsMigration?: boolean; error?: string }> {
    try {
      const index = await this.loadRepositoryIndex(projectPath)

      if (!index) {
        return { success: true, items: [] }
      }

      if (index.items.length === 0) {
        return { success: true, items: [] }
      }

      // V2 index is valid only when every item has inline device summaries.
      // Any item missing `devices` means we either have a v1 index or a
      // partially-migrated v2 — in both cases, trigger migration.
      const allItemsHaveDevices = index.version === 2 && index.items.every((i) => i.devices !== undefined)
      if (allItemsHaveDevices) {
        const items = await this.loadLightItemsFromIndex(projectPath)
        return { success: true, items }
      }

      return { success: true, needsMigration: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load repository',
      }
    }
  }

  /**
   * Migrate a v1 repository to v2 by re-parsing all XML files with parseESILight
   */
  async migrateRepositoryToV2(
    projectPath: string,
  ): Promise<{ success: boolean; items?: ESIRepositoryItemLight[]; error?: string }> {
    return this.withIndexLock(async () => {
      try {
        const index = await this.loadRepositoryIndex(projectPath)
        if (!index) {
          return { success: true, items: [] }
        }

        const items: ESIRepositoryItemLight[] = []

        for (const indexItem of index.items) {
          try {
            const xmlResult = await this.loadXmlFile(projectPath, indexItem.id)
            if (xmlResult.success && xmlResult.content) {
              const parseResult = parseESILight(xmlResult.content, indexItem.filename)
              if (parseResult.success && parseResult.vendor && parseResult.devices) {
                items.push({
                  id: indexItem.id,
                  filename: indexItem.filename,
                  vendor: parseResult.vendor,
                  devices: parseResult.devices,
                  loadedAt: msToIso(indexItem.loadedAt),
                  warnings: parseResult.warnings || indexItem.warnings,
                })
              }
            }
          } catch (err) {
            console.error(`Failed to migrate ESI file ${indexItem.filename}:`, err)
          }
        }

        // Save as v2
        const saveResult = await this.saveRepositoryIndexV2(projectPath, items)
        if (!saveResult.success) {
          return { success: false, error: saveResult.error || 'Failed to save migrated index' }
        }

        return { success: true, items }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to migrate repository',
        }
      }
    })
  }

  /**
   * Parse and save a single ESI file. Returns the saved item on success.
   * Called once per file from the renderer's sequential upload loop.
   *
   * ## Duplicate handling
   * When `filename` already exists in the repository index, we return
   * `{ success: true, duplicate: true }` WITHOUT `item`. The adapter (and
   * ultimately the UI) treats this as a no-op rather than an error — uploading
   * the same file again is not a failure, it's just nothing to do. Callers
   * that need to distinguish "added" from "skipped" must check `duplicate` or
   * the presence of `item`.
   */
  async parseAndSaveFile(
    projectPath: string,
    filename: string,
    content: string,
  ): Promise<{ success: boolean; item?: ESIRepositoryItemLight; duplicate?: boolean; error?: string }> {
    // Parse outside the lock (CPU-bound, no index access)
    const parseResult = parseESILight(content, filename)
    if (!parseResult.success || !parseResult.vendor || !parseResult.devices) {
      return { success: false, error: parseResult.error || 'Parse failed' }
    }

    return this.withIndexLock(async () => {
      try {
        // Check for duplicate
        const existingIndex = await this.loadRepositoryIndex(projectPath)
        const existingFilenames = new Set(existingIndex?.items.map((i) => i.filename) ?? [])
        if (existingFilenames.has(filename)) {
          // Skip duplicate: success with an explicit `duplicate` flag so the
          // caller can tell this apart from a real add without inferring it
          // from a missing `item`.
          return { success: true, duplicate: true }
        }

        // Save XML to disk
        const itemId = uuidv4()
        const saveResult = await this.saveXmlFile(projectPath, itemId, content)
        if (!saveResult.success) {
          return { success: false, error: saveResult.error ?? 'Failed to save XML file' }
        }

        const item: ESIRepositoryItemLight = {
          id: itemId,
          filename,
          vendor: parseResult.vendor!,
          devices: parseResult.devices!,
          loadedAt: new Date().toISOString(),
          warnings: parseResult.warnings,
        }

        // Append to v2 index. If the index write fails, delete the XML we just
        // wrote so we don't leave an orphan that's unreferenced by the index.
        const currentItems = await this.loadLightItemsFromIndex(projectPath)
        const indexResult = await this.saveRepositoryIndexV2(projectPath, [...currentItems, item])
        if (!indexResult.success) {
          await this.deleteXmlFile(projectPath, itemId)
          return { success: false, error: indexResult.error ?? 'Failed to update repository index' }
        }

        return { success: true, item }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    })
  }

  /**
   * Clear the entire ESI repository: delete all XML files and reset the index.
   */
  async clearRepository(projectPath: string): Promise<ESIServiceResponse> {
    return this.withIndexLock(async () => {
      try {
        const esiDir = this.getEsiDir(projectPath)
        if (!fileOrDirectoryExists(esiDir)) return { success: true }

        // Delete only XML files, not the index
        const entries = await promises.readdir(esiDir)
        const xmlFiles = entries.filter((entry) => entry.endsWith('.xml'))
        await Promise.all(xmlFiles.map((entry) => promises.unlink(join(esiDir, entry))))

        // Write empty v2 index
        const repoPath = this.getRepositoryPath(projectPath)
        await promises.writeFile(repoPath, JSON.stringify({ version: 2, items: [] }, null, 2), 'utf-8')

        return { success: true }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to clear repository',
        }
      }
    })
  }

  /**
   * Check if ESI directory exists for a project
   */
  hasEsiDirectory(projectPath: string): boolean {
    return fileOrDirectoryExists(this.getEsiDir(projectPath))
  }

  /**
   * Get list of XML files in the ESI directory
   */
  async listXmlFiles(projectPath: string): Promise<string[]> {
    const esiDir = this.getEsiDir(projectPath)

    if (!fileOrDirectoryExists(esiDir)) {
      return []
    }

    try {
      const entries = await promises.readdir(esiDir)
      return entries.filter((entry) => entry.endsWith('.xml'))
    } catch {
      return []
    }
  }
}

export { ESIService }
export type { ESIRepositoryIndex, ESIServiceResponse }
