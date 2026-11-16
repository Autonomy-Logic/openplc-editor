/**
 * Mechanisms behind the ESI repository port.
 *
 * All repository behaviour is shared (`backend/shared/ethercat/esi-repository-port.ts`
 * and `esi-file-store.ts`). A platform supplies only mechanisms, which make
 * no decisions: where the parser runs, and where rows or files are kept.
 */

import type { ESIDevice, ESIModule, ESIRepositoryItemLight } from './esi-types'

/** What an ESI file contributes to its repository row, as the light parse returns it. */
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

/** A repository row. Stores keep it exactly as given and return it exactly as kept. */
export interface EsiStoredRow {
  id: string
  filename: string
  /** ISO 8601 UTC */
  loadedAt: string
  /** SHA-256 hex of the XML. */
  contentHash?: string
  /** Version of the parser output in `summary`; rows from another version are re-parsed. */
  summaryVersion?: number
  summary?: ESIRepositorySummary
}

/** Row storage (the Edge backend on the web). Stores and returns rows verbatim. */
export interface EsiRowStore {
  list(): Promise<EsiStoredRow[]>
  /** Keep a new row and its XML; returns the row as kept, whose id the store may have assigned. */
  insert(row: EsiStoredRow, xml: string): Promise<EsiStoredRow>
  /** Replace the row with the same id. */
  update(row: EsiStoredRow): Promise<void>
  remove(id: string): Promise<void>
  clear(): Promise<void>
  readXml(id: string): Promise<string>
  /** Subscribe to a change of whose repository this is (account, project). */
  onScopeChanged?(listener: () => void): () => void
}

/** Text files in one folder (the project's `devices/esi` on the desktop). */
export interface EsiFileStore {
  /** The file's text, or null when it does not exist. */
  read(name: string): Promise<string | null>
  /** Replace the file atomically. */
  write(name: string, text: string): Promise<void>
  /** Delete the file; a missing file is not an error. */
  remove(name: string): Promise<void>
  /** Names of the files in the folder. */
  list(): Promise<string[]>
  /** Subscribe to a change of which folder this is (project switch). */
  onScopeChanged?(listener: () => void): () => void
}
