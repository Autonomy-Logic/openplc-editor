import type { ESIRepositorySummary, EsiStoredRecord } from '@root/middleware/shared/ports/esi-repository-mechanisms'
import { createHash } from 'crypto'
import { promises } from 'fs'
import { basename, dirname, join } from 'path'
import { v4 as uuidv4 } from 'uuid'

import { resolveProjectDataDir } from '../project/cloud-project-data'
import { fileOrDirectoryExists } from '../utils'

/**
 * On-disk ESI store: the desktop's storage mechanism for the shared ESI
 * repository port (`middleware/shared/utils/ethercat/esi-repository.ts`).
 *
 * It only stores. Each XML is saved as `devices/esi/<id>.xml`, and
 * `devices/esi/repository.json` keeps one row per file with the summary the
 * shared port hands in, written and read back verbatim. Like the Edge
 * backend, it keys content by SHA-256, so identical bytes are a duplicate
 * whatever the filename.
 *
 * Indexes written by older Editors (version 1 and 2) are read as rows without
 * a summary: their summaries were rebuilt field by field and are incomplete
 * (4.3.3 dropped `modules`). The shared port re-parses those rows and stores
 * the result through `saveSummary`, which rewrites the index as version 3.
 */

const INDEX_VERSION = 3

interface StoredRow {
  id: string
  filename: string
  loadedAt: string
  contentHash?: string
  summary?: ESIRepositorySummary
}

interface IndexV3 {
  version: 3
  items: StoredRow[]
}

/** Index from Editors before version 3: loadedAt in Unix ms, summary fields inline. */
interface LegacyIndex {
  version: number
  items: Array<{ id: string; filename: string; loadedAt: number }>
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

function toRecord(row: StoredRow): EsiStoredRecord {
  return { id: row.id, filename: row.filename, loadedAt: row.loadedAt, ...(row.summary && { summary: row.summary }) }
}

class EsiDiskStore {
  private readonly ESI_DIR = 'devices/esi'
  private readonly REPOSITORY_FILE = 'repository.json'
  private indexLock: Promise<void> = Promise.resolve()

  /** Serialize access to the index so concurrent uploads cannot lose rows. */
  private withIndexLock<T>(fn: () => Promise<T>): Promise<T> {
    const current = this.indexLock
    let resolve: () => void
    this.indexLock = new Promise<void>((r) => (resolve = r))
    return current.then(fn).finally(() => resolve!())
  }

  private getEsiDir(projectPath: string): string {
    const basePath = basename(projectPath) === 'project.json' ? dirname(projectPath) : projectPath
    // A cloud project is an Edge id, not a directory: joining on it directly wrote
    // the repository into `process.cwd()`. ESI is never part of the project
    // envelope, so its copy has to outlive a restart on this machine.
    return join(resolveProjectDataDir(basePath), this.ESI_DIR)
  }

  private getRepositoryPath(projectPath: string): string {
    return join(this.getEsiDir(projectPath), this.REPOSITORY_FILE)
  }

  /** Validates the id is a UUID so it can never walk out of the ESI folder. */
  private getXmlPath(projectPath: string, itemId: string): string {
    if (!UUID_REGEX.test(itemId)) throw new Error(`Invalid item ID: ${itemId}`)
    return join(this.getEsiDir(projectPath), `${itemId}.xml`)
  }

  private async readIndex(projectPath: string): Promise<StoredRow[]> {
    const repoPath = this.getRepositoryPath(projectPath)
    let content: string
    try {
      content = await promises.readFile(repoPath, 'utf-8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      // Permission, locked file, ...: never treat as empty, or the next write would overwrite it.
      throw error
    }

    let index: IndexV3 | LegacyIndex
    try {
      index = JSON.parse(content) as IndexV3 | LegacyIndex
    } catch (parseError) {
      // Keep the corrupt file for forensics and start empty; the XMLs stay on disk.
      const backupPath = `${repoPath}.corrupt-${Date.now()}.bak`
      await promises.rename(repoPath, backupPath).catch(() => undefined)
      console.warn(`[EsiDiskStore] Corrupt index at ${repoPath}, moved to ${backupPath}.`, parseError)
      return []
    }

    if (index.version === INDEX_VERSION) return (index as IndexV3).items
    return (index as LegacyIndex).items.map((row) => ({
      id: row.id,
      filename: row.filename,
      loadedAt: new Date(row.loadedAt).toISOString(),
    }))
  }

  private async writeIndex(projectPath: string, items: StoredRow[]): Promise<void> {
    await promises.mkdir(this.getEsiDir(projectPath), { recursive: true })
    const repoPath = this.getRepositoryPath(projectPath)
    const index: IndexV3 = { version: INDEX_VERSION, items }
    const tmpPath = `${repoPath}.tmp`
    await promises.writeFile(tmpPath, JSON.stringify(index, null, 2), 'utf-8')
    await promises.rename(tmpPath, repoPath)
  }

  async list(projectPath: string): Promise<EsiStoredRecord[]> {
    return (await this.readIndex(projectPath)).map(toRecord)
  }

  async upload(
    projectPath: string,
    input: { filename: string; content: string; summary: ESIRepositorySummary },
  ): Promise<{ record: EsiStoredRecord | null; duplicate: boolean; retried: boolean }> {
    const contentHash = sha256(input.content)
    return this.withIndexLock(async () => {
      const rows = await this.readIndex(projectPath)
      const match = rows.find((row) => row.contentHash === contentHash)
      if (match) return { record: toRecord(match), duplicate: true, retried: false }

      const row: StoredRow = {
        id: uuidv4(),
        filename: input.filename,
        loadedAt: new Date().toISOString(),
        contentHash,
        summary: input.summary,
      }
      const xmlPath = this.getXmlPath(projectPath, row.id)
      await promises.mkdir(this.getEsiDir(projectPath), { recursive: true })
      await promises.writeFile(xmlPath, input.content, 'utf-8')
      try {
        await this.writeIndex(projectPath, [...rows, row])
      } catch (error) {
        // Never leave an XML the index does not reference.
        await promises.unlink(xmlPath).catch(() => undefined)
        throw error
      }
      return { record: toRecord(row), duplicate: false, retried: false }
    })
  }

  async saveSummary(projectPath: string, id: string, summary: ESIRepositorySummary): Promise<void> {
    const contentHash = sha256(await this.readXml(projectPath, id))
    await this.withIndexLock(async () => {
      const rows = await this.readIndex(projectPath)
      await this.writeIndex(
        projectPath,
        rows.map((row) => (row.id === id ? { ...row, contentHash, summary } : row)),
      )
    })
  }

  async remove(projectPath: string, id: string): Promise<void> {
    const xmlPath = this.getXmlPath(projectPath, id)
    await this.withIndexLock(async () => {
      await promises.unlink(xmlPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
      })
      const rows = await this.readIndex(projectPath)
      await this.writeIndex(
        projectPath,
        rows.filter((row) => row.id !== id),
      )
    })
  }

  async clear(projectPath: string): Promise<void> {
    await this.withIndexLock(async () => {
      const esiDir = this.getEsiDir(projectPath)
      if (!fileOrDirectoryExists(esiDir)) return
      const entries = await promises.readdir(esiDir)
      await Promise.all(entries.filter((e) => e.endsWith('.xml')).map((e) => promises.unlink(join(esiDir, e))))
      await this.writeIndex(projectPath, [])
    })
  }

  async readXml(projectPath: string, id: string): Promise<string> {
    try {
      return await promises.readFile(this.getXmlPath(projectPath, id), 'utf-8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('XML file not found')
      throw error
    }
  }
}

export { EsiDiskStore }
