import type { PersistenceLoadResult, PersistenceSaveResult, VariablePersistencePort } from '../application/ports'
import { isVariableType, type Variable, type VariableDocument } from '../domain'

/** The subset of the Web Storage API the adapter needs; `window.localStorage` satisfies it, and so does a test Map. */
export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

// Stored alongside the data so a future format change can be detected and migrated.
const FORMAT_VERSION = 1

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStoredVariable(value: unknown): value is Variable {
  return isRecord(value) && Number.isInteger(value.id) && typeof value.name === 'string' && isVariableType(value.type)
}

// Boundary validation: parsed JSON is `unknown` until every field is checked. Unknown fields are dropped.
function readStoredDocument(value: unknown): VariableDocument | null {
  if (!isRecord(value) || value.version !== FORMAT_VERSION) return null
  const { nextId, variables } = value
  if (typeof nextId !== 'number' || !Number.isInteger(nextId) || !Array.isArray(variables)) return null
  const parsed: Variable[] = []
  for (const candidate of variables) {
    if (!isStoredVariable(candidate)) return null
    parsed.push({ id: candidate.id, name: candidate.name, type: candidate.type })
  }
  return { nextId, variables: parsed }
}

function load(storage: KeyValueStorage, key: string): PersistenceLoadResult {
  // Storage access and JSON.parse can both throw; every failure becomes `{ ok: false }`.
  try {
    const raw = storage.getItem(key)
    if (raw === null) return { ok: true, document: null }
    const parsed: unknown = JSON.parse(raw)
    const document = readStoredDocument(parsed)
    return document ? { ok: true, document } : { ok: false }
  } catch {
    return { ok: false }
  }
}

function save(storage: KeyValueStorage, key: string, document: VariableDocument): PersistenceSaveResult {
  try {
    storage.setItem(key, JSON.stringify({ version: FORMAT_VERSION, ...document }))
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

/**
 * Infrastructure layer: implements the persistence port on top of Web Storage. It knows the storage format
 * and validates its shape; whether the content obeys the domain rules is checked by the application.
 */
export function createLocalStoragePersistence(storage: KeyValueStorage, key: string): VariablePersistencePort {
  // Web Storage is synchronous; the port is asynchronous so slower adapters (HTTP, IPC) fit the same contract.
  return {
    load: () => Promise.resolve(load(storage, key)),
    save: (document) => Promise.resolve(save(storage, key, document)),
  }
}
