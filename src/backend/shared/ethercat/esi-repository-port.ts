/**
 * The ESI repository port, shared by every platform.
 *
 * Holds all repository behaviour: parse acceptance, the row and its summary,
 * content hashing and duplicate detection, re-parsing rows from another parser
 * version, caching of XML and parsed devices, and module lookup by ident.
 * Platforms supply only a parser mechanism and a row store
 * (`ports/esi-repository-mechanisms.ts`).
 *
 * Row ids never change for given content, so only delete, clear and a scope
 * change (account, project) invalidate the caches.
 */

import { newUuid } from '@root/frontend/utils/new-uuid'
import type { EsiPort } from '@root/middleware/shared/ports/esi-port'
import type {
  EsiParserMechanism,
  ESIRepositorySummary,
  EsiRowStore,
  EsiStoredRow,
} from '@root/middleware/shared/ports/esi-repository-mechanisms'
import type { ESIDevice, ESIModule, ESIRepositoryItemLight } from '@root/middleware/shared/ports/esi-types'
import { findModuleByIdent } from '@root/middleware/shared/utils/ethercat/esi-module-resolve'
import { createPromiseLruCache } from '@root/middleware/shared/utils/ethercat/promise-lru-cache'

import { hashText } from '../project/project-snapshot-archive'

/** Version of the summary the light parse produces. Rows stored with another version are re-parsed. */
export const ESI_SUMMARY_VERSION = 2

// ~64 MB for ASCII XML (V8 stores it one byte per char): room for a few family files, never a pile of 100 MB ones.
const XML_CACHE_MAX_CHARS = 64 * 1024 * 1024
// Parsed devices are small next to their XML; 64 covers a large bus plus the browser without re-parsing.
const DEVICE_CACHE_MAX_ENTRIES = 64

type CurrentRow = EsiStoredRow & { summary: ESIRepositorySummary; contentHash: string }

function isCurrent(row: EsiStoredRow): row is CurrentRow {
  return row.summary !== undefined && row.contentHash !== undefined && row.summaryVersion === ESI_SUMMARY_VERSION
}

function deviceCacheKey(itemId: string, deviceIndex: number): string {
  return `${deviceIndex}:${itemId}`
}

function isDeviceCacheKeyOf(key: string, itemId: string): boolean {
  return key.slice(key.indexOf(':') + 1) === itemId
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message || fallback
  return String(err) || fallback
}

/** The row the UI sees: the summary plus the row's identity. */
export function toRepositoryItem(row: EsiStoredRow & { summary: ESIRepositorySummary }): ESIRepositoryItemLight {
  return { ...row.summary, id: row.id, filename: row.filename, loadedAt: row.loadedAt }
}

export interface EsiRepositoryMechanisms {
  parser: EsiParserMechanism
  store: EsiRowStore
}

export function createEsiRepositoryPort({ parser, store }: EsiRepositoryMechanisms): EsiPort {
  const xmlCache = createPromiseLruCache<string>({ maxWeight: XML_CACHE_MAX_CHARS, weigh: (xml) => xml.length })
  const deviceCache = createPromiseLruCache<ESIDevice>({ maxWeight: DEVICE_CACHE_MAX_ENTRIES, weigh: () => 1 })
  // Rows as last listed, kept in step with every write; the duplicate check reads them.
  let rows: CurrentRow[] | null = null

  store.onScopeChanged?.(() => {
    xmlCache.clear()
    deviceCache.clear()
    rows = null
  })

  function invalidateItem(itemId: string): void {
    xmlCache.delete(itemId)
    deviceCache.deleteWhere((key) => isDeviceCacheKeyOf(key, itemId))
  }

  function loadXml(itemId: string): Promise<string> {
    return xmlCache.load(itemId, () => store.readXml(itemId))
  }

  /** Parse an ESI file into the summary its row carries, or explain why it is not an ESI. */
  async function summarize(
    xml: string,
    filename: string,
  ): Promise<{ summary: ESIRepositorySummary } | { error: string }> {
    const parsed = await parser.run({ op: 'light', xml, filename })
    if (!parsed.success || !parsed.vendor || !parsed.devices) {
      return { error: parsed.error ?? 'Failed to parse ESI file' }
    }
    const { success: _success, error: _error, ...rest } = parsed
    return { summary: { ...rest, vendor: parsed.vendor, devices: parsed.devices } }
  }

  /** Bring a row from another parser version up to date: re-parse its XML once and store the result. */
  async function refresh(row: EsiStoredRow): Promise<CurrentRow | null> {
    try {
      const xml = await loadXml(row.id)
      const result = await summarize(xml, row.filename)
      if ('error' in result) {
        console.error(`ESI file ${row.filename} could not be re-read: ${result.error}`)
        return null
      }
      const next: CurrentRow = {
        ...row,
        contentHash: await hashText(xml),
        summaryVersion: ESI_SUMMARY_VERSION,
        summary: result.summary,
      }
      // Shown even if the store cannot keep it; the next load tries again.
      await store.update(next).catch((err: unknown) => console.error(`ESI file ${row.filename} not updated:`, err))
      return next
    } catch (err) {
      console.error(`ESI file ${row.filename} could not be re-read:`, err)
      return null
    }
  }

  async function listRows(): Promise<CurrentRow[]> {
    const listed: CurrentRow[] = []
    for (const row of await store.list()) {
      const current = isCurrent(row) ? row : await refresh(row)
      if (current) listed.push(current)
    }
    rows = listed
    return listed
  }

  async function loadItems() {
    try {
      const items = (await listRows()).map(toRepositoryItem)
      return { success: true as const, items, needsMigration: false }
    } catch (err) {
      return { success: false as const, error: errorMessage(err, 'Failed to load ESI repository') }
    }
  }

  async function parseDevice(itemId: string, deviceIndex: number): Promise<ESIDevice> {
    const parsed = await parser.run({ op: 'deviceFull', xml: await loadXml(itemId), deviceIndex })
    if (!parsed.success || !parsed.device) throw new Error(parsed.error ?? 'Failed to parse ESI device')
    return parsed.device
  }

  return {
    loadRepositoryLight: loadItems,

    // Rows are brought up to date as they load, so there is never a separate migration step.
    migrateRepository: loadItems,

    async parseAndSaveFile(filename, content) {
      let summary: ESIRepositorySummary
      let contentHash: string
      try {
        // The parser thread can reject (a crash or out-of-memory on a huge XML); that becomes a Result error.
        const result = await summarize(content, filename)
        if ('error' in result) return { success: false, error: result.error }
        summary = result.summary
        contentHash = await hashText(content)
      } catch (err) {
        return { success: false, error: errorMessage(err, 'Failed to parse ESI file') }
      }

      try {
        const known = rows ?? (await listRows())
        if (known.some((row) => row.contentHash === contentHash)) return { success: true, duplicate: true }

        const row: CurrentRow = {
          id: newUuid(),
          filename,
          loadedAt: new Date().toISOString(),
          contentHash,
          summaryVersion: ESI_SUMMARY_VERSION,
          summary,
        }
        const kept = await store.insert(row, content)
        const stored: CurrentRow = { ...row, ...kept, contentHash, summaryVersion: ESI_SUMMARY_VERSION, summary }
        rows = [...known.filter((r) => r.id !== stored.id), stored]
        return { success: true, item: toRepositoryItem(stored) }
      } catch (err) {
        return { success: false, error: errorMessage(err, 'Failed to upload ESI file') }
      }
    },

    async deleteRepositoryItem(itemId) {
      invalidateItem(itemId)
      try {
        await store.remove(itemId)
        if (rows) rows = rows.filter((r) => r.id !== itemId)
        return { success: true }
      } catch (err) {
        return { success: false, error: errorMessage(err, 'Failed to delete ESI item') }
      }
    },

    async clearRepository() {
      xmlCache.clear()
      deviceCache.clear()
      try {
        await store.clear()
        rows = []
        return { success: true }
      } catch (err) {
        rows = null
        return { success: false, error: errorMessage(err, 'Failed to clear ESI repository') }
      }
    },

    async loadDeviceFull(itemId, deviceIndex) {
      let device: ESIDevice
      try {
        device = await deviceCache.load(deviceCacheKey(itemId, deviceIndex), () => parseDevice(itemId, deviceIndex))
      } catch (err) {
        return { success: false, error: errorMessage(err, 'Failed to load ESI XML') }
      }
      // Callers own the returned device; the cached one must stay untouched.
      return { success: true, device: structuredClone(device) }
    },

    async loadModuleFull(itemId, ident) {
      try {
        const parsed = await parser.run({ op: 'modules', xml: await loadXml(itemId) })
        if (!parsed.success) return { success: false, error: parsed.error ?? 'Failed to parse module ESI' }
        const module: ESIModule | undefined = findModuleByIdent(parsed.modules ?? [], ident)
        if (module === undefined) return { success: false, error: `Module ident ${ident} not found` }
        return { success: true, module: structuredClone(module) }
      } catch (err) {
        return { success: false, error: errorMessage(err, 'Failed to load ESI module') }
      }
    },
  }
}
