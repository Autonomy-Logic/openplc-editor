import type { VariablePersistencePort } from '../application/ports'
import type { VariableDocument } from '../domain'

/** The port plus `stored`, which lets tests assert what was written without a real storage. */
export interface InMemoryPersistence extends VariablePersistencePort {
  readonly stored: () => VariableDocument | null
}

/** Second implementation of the same port, used by tests: proof that the application does not care where data lives. */
export function createInMemoryPersistence(initial: VariableDocument | null = null): InMemoryPersistence {
  let stored = initial
  return {
    load: () => Promise.resolve({ ok: true, document: stored }),
    save: (document) => {
      stored = document
      return Promise.resolve({ ok: true })
    },
    stored: () => stored,
  }
}
