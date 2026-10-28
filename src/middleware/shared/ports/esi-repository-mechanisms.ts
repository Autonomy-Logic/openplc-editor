/**
 * Mechanisms behind the ESI repository.
 *
 * The ESI port itself is shared (`middleware/shared/utils/ethercat/esi-repository.ts`):
 * parsing rules, the repository row, dedup interpretation, caching and error
 * wording are the same on every platform. Each platform only supplies the two
 * mechanisms below, and they must stay logic-agnostic:
 *
 *   - EsiParserMechanism: WHERE the shared parser runs (a Web Worker on web,
 *     the main process on the desktop). It runs `runEsiParseOp` and hands the
 *     result back untouched.
 *   - EsiStoreMechanism:  WHERE files and rows live (the Edge backend on web,
 *     the project's `devices/esi/` folder on the desktop). It stores the
 *     summary it is given verbatim and returns it verbatim, so a field added to
 *     the parser reaches every platform without touching platform code.
 */

import type { ESIDevice, ESIModule, ESIRepositoryItemLight } from './esi-types'

/** Everything an ESI file contributes to its repository row, exactly as the light parse returns it. */
export type ESIRepositorySummary = Omit<ESIRepositoryItemLight, 'id' | 'filename' | 'loadedAt'>

/** One request to the shared ESI parser. */
export type EsiParseOp =
  | { op: 'light'; xml: string; filename?: string }
  | { op: 'deviceFull'; xml: string; deviceIndex: number }
  | { op: 'modules'; xml: string }

export interface EsiLightParse extends Partial<ESIRepositorySummary> {
  success: boolean
  error?: string
}

export interface EsiDeviceParse {
  success: boolean
  device?: ESIDevice
  error?: string
}

export interface EsiModulesParse {
  success: boolean
  modules?: ESIModule[]
  error?: string
}

export type EsiParseResult<T extends EsiParseOp> = T extends { op: 'light' }
  ? EsiLightParse
  : T extends { op: 'deviceFull' }
    ? EsiDeviceParse
    : EsiModulesParse

/** Runs one parse request on the platform's parsing thread and returns the result unchanged. */
export interface EsiParserMechanism {
  run<T extends EsiParseOp>(request: T): Promise<EsiParseResult<T>>
}

/**
 * A stored repository row. `summary` is absent only for rows written by an
 * older Editor whose summary is incomplete; the shared port re-parses those.
 */
export interface EsiStoredRecord {
  id: string
  filename: string
  /** ISO 8601 UTC */
  loadedAt: string
  summary?: ESIRepositorySummary
}

export interface EsiStoreUploadResult {
  /** The stored row: the new one, or the matched one on a duplicate when the store echoes it. */
  record: EsiStoredRecord | null
  /** The store already holds this content (same bytes). */
  duplicate: boolean
  /** The transport retried the upload after a transient failure before this answer arrived. */
  retried: boolean
}

/**
 * Persistence for ESI files. Every method throws an `Error` whose message is
 * fit to show the user when the operation fails.
 */
export interface EsiStoreMechanism {
  list(): Promise<EsiStoredRecord[]>
  /** Store the XML with its summary. Identical content is a duplicate, whatever the filename. */
  upload(input: { filename: string; content: string; summary: ESIRepositorySummary }): Promise<EsiStoreUploadResult>
  /** Replace the summary of a row whose summary was missing. */
  saveSummary(id: string, summary: ESIRepositorySummary): Promise<void>
  remove(id: string): Promise<void>
  clear(): Promise<void>
  readXml(id: string): Promise<string>
  /** Subscribe to a change of whose repository this is (account sign-in/out); the port drops its caches. */
  onScopeChanged?(listener: () => void): () => void
}
