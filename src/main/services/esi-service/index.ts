import { fileOrDirectoryExists } from '@root/main/utils'
import type { ESIDeviceSummary, ESIRepositoryItem, ESIRepositoryItemLight } from '@root/types/ethercat/esi-types'
import { promises } from 'fs'
import { join } from 'path'
import { v4 as uuidv4 } from 'uuid'

import { parseESILight } from './esi-parser-main'

/**
 * ESI Repository Index stored in devices/esi/repository.json
 * Version 2 includes device summaries inline for instant loading.
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

  /**
   * Get the ESI directory path for a project
   */
  private getEsiDir(projectPath: string): string {
    const basePath = projectPath.endsWith('/project.json') ? projectPath.slice(0, -'/project.json'.length) : projectPath
    return join(basePath, this.ESI_DIR)
  }

  /**
   * Get the repository index file path
   */
  private getRepositoryPath(projectPath: string): string {
    return join(this.getEsiDir(projectPath), this.REPOSITORY_FILE)
  }

  /**
   * Get the path for an ESI XML file
   */
  private getXmlPath(projectPath: string, itemId: string): string {
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

    if (!fileOrDirectoryExists(repoPath)) {
      return null
    }

    try {
      const content = await promises.readFile(repoPath, 'utf-8')
      const index = JSON.parse(content) as ESIRepositoryIndex
      return index
    } catch (error) {
      console.error('Error reading ESI repository index:', error)
      return null
    }
  }

  /**
   * Save the ESI repository index to disk (v1 format for backward compat)
   */
  async saveRepositoryIndex(projectPath: string, items: ESIRepositoryItem[]): Promise<ESIServiceResponse> {
    try {
      await this.ensureEsiDir(projectPath)

      const index: ESIRepositoryIndex = {
        version: 1,
        items: items.map((item) => ({
          id: item.id,
          filename: item.filename,
          vendorId: item.vendor.id,
          vendorName: item.vendor.name,
          deviceCount: item.devices.length,
          loadedAt: item.loadedAt,
          warnings: item.warnings,
        })),
      }

      const repoPath = this.getRepositoryPath(projectPath)
      await promises.writeFile(repoPath, JSON.stringify(index, null, 2), 'utf-8')

      return { success: true }
    } catch (error) {
      console.error('Error saving ESI repository index:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to save repository index',
      }
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
          loadedAt: item.loadedAt,
          warnings: item.warnings,
          devices: item.devices,
        })),
      }

      const repoPath = this.getRepositoryPath(projectPath)
      await promises.writeFile(repoPath, JSON.stringify(index, null, 2), 'utf-8')

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

      if (!fileOrDirectoryExists(xmlPath)) {
        return { success: false, error: 'XML file not found' }
      }

      const content = await promises.readFile(xmlPath, 'utf-8')
      return { success: true, content }
    } catch (error) {
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

      if (fileOrDirectoryExists(xmlPath)) {
        await promises.unlink(xmlPath)
      }

      return { success: true }
    } catch (error) {
      console.error('Error deleting ESI XML file:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete XML file',
      }
    }
  }

  /**
   * Save a complete ESI repository item (XML + update index)
   */
  async saveRepositoryItem(
    projectPath: string,
    item: ESIRepositoryItem,
    xmlContent: string,
    existingItems: ESIRepositoryItem[],
  ): Promise<ESIServiceResponse> {
    // Save the XML file
    const xmlResult = await this.saveXmlFile(projectPath, item.id, xmlContent)
    if (!xmlResult.success) {
      return xmlResult
    }

    // Update the index with the new item
    const updatedItems = [...existingItems.filter((i) => i.id !== item.id), item]
    return this.saveRepositoryIndex(projectPath, updatedItems)
  }

  /**
   * Delete a repository item (XML + update index)
   */
  async deleteRepositoryItem(
    projectPath: string,
    itemId: string,
    existingItems: ESIRepositoryItem[],
  ): Promise<ESIServiceResponse> {
    // Delete the XML file
    const deleteResult = await this.deleteXmlFile(projectPath, itemId)
    if (!deleteResult.success) {
      return deleteResult
    }

    // Update the index without the deleted item
    const updatedItems = existingItems.filter((i) => i.id !== itemId)
    return this.saveRepositoryIndex(projectPath, updatedItems)
  }

  /**
   * Load light items from the v2 repository index
   */
  private async loadLightItemsFromIndex(projectPath: string): Promise<ESIRepositoryItemLight[]> {
    const index = await this.loadRepositoryIndex(projectPath)
    if (!index || index.version !== 2) return []
    return index.items
      .filter((i) => i.devices)
      .map((i) => ({
        id: i.id,
        filename: i.filename,
        vendor: { id: i.vendorId, name: i.vendorName },
        devices: i.devices || [],
        loadedAt: i.loadedAt,
        warnings: i.warnings,
      }))
  }

  /**
   * Load repository as lightweight items (v2 instant, v1 needs migration)
   */
  async loadRepositoryLight(
    projectPath: string,
  ): Promise<{ success: boolean; items?: ESIRepositoryItemLight[]; needsMigration?: boolean; error?: string }> {
    try {
      const index = await this.loadRepositoryIndex(projectPath)

      if (!index) {
        return { success: true, items: [] }
      }

      // V2 index has device summaries inline
      if (index.version === 2 && index.items.length > 0 && index.items[0].devices) {
        const items = await this.loadLightItemsFromIndex(projectPath)
        return { success: true, items }
      }

      // V1 index needs migration
      if (index.items.length > 0) {
        return { success: true, needsMigration: true }
      }

      return { success: true, items: [] }
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
                loadedAt: indexItem.loadedAt,
                warnings: parseResult.warnings || indexItem.warnings,
              })
            }
          }
        } catch (err) {
          console.error(`Failed to migrate ESI file ${indexItem.filename}:`, err)
        }
      }

      // Save as v2
      await this.saveRepositoryIndexV2(projectPath, items)

      return { success: true, items }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to migrate repository',
      }
    }
  }

  /**
   * Parse and save a single ESI file. Returns the saved item on success.
   * Called once per file from the renderer's sequential upload loop.
   */
  async parseAndSaveFile(
    projectPath: string,
    filename: string,
    content: string,
  ): Promise<{ success: boolean; item?: ESIRepositoryItemLight; error?: string }> {
    try {
      // Check for duplicate
      const existingIndex = await this.loadRepositoryIndex(projectPath)
      const existingFilenames = new Set(existingIndex?.items.map((i) => i.filename) ?? [])
      if (existingFilenames.has(filename)) {
        return { success: true } // skip duplicate silently
      }

      // Parse
      const parseResult = parseESILight(content, filename)
      if (!parseResult.success || !parseResult.vendor || !parseResult.devices) {
        return { success: false, error: parseResult.error || 'Parse failed' }
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
        vendor: parseResult.vendor,
        devices: parseResult.devices,
        loadedAt: Date.now(),
        warnings: parseResult.warnings,
      }

      // Append to v2 index
      const currentItems = await this.loadLightItemsFromIndex(projectPath)
      await this.saveRepositoryIndexV2(projectPath, [...currentItems, item])

      return { success: true, item }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Clear the entire ESI repository: delete all XML files and reset the index.
   */
  async clearRepository(projectPath: string): Promise<ESIServiceResponse> {
    try {
      const esiDir = this.getEsiDir(projectPath)
      if (!fileOrDirectoryExists(esiDir)) return { success: true }

      // Delete all files in the ESI directory
      const entries = await promises.readdir(esiDir)
      await Promise.all(entries.map((entry) => promises.unlink(join(esiDir, entry))))

      // Recreate directory with empty v2 index
      await this.ensureEsiDir(projectPath)
      const repoPath = this.getRepositoryPath(projectPath)
      await promises.writeFile(repoPath, JSON.stringify({ version: 2, items: [] }, null, 2), 'utf-8')

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to clear repository',
      }
    }
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
