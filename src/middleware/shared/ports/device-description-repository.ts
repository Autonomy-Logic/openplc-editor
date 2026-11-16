/** A repository row with summary type `S`. Stores keep it exactly as given and return it exactly as kept. */
export interface DescriptionStoredRow<S> {
  id: string
  /** ISO 8601 UTC */
  loadedAt: string
  filename: string
  /** SHA-256 hex of the XML. */
  contentHash?: string
  /** Version of the parser output in `summary`; rows from another version are re-parsed. */
  summaryVersion?: number
  summary?: S
}

/**
 * The row store of a device-description repository: a catalog of XML device-description files, each kept as a row
 * with the summary its parser produced. A platform supplies it (the Edge backend on the web); it stores and returns
 * rows verbatim and makes no decisions. The repository behaviour is in
 * `backend/shared/device-description/description-repository.ts`.
 */
export interface DescriptionRowStore<S> {
  list(): Promise<DescriptionStoredRow<S>[]>
  /** Keep a new row and its XML; returns the row as kept, whose id the store may have assigned. */
  insert(row: DescriptionStoredRow<S>, xml: string): Promise<DescriptionStoredRow<S>>
  /** Replace the row with the same id. */
  update(row: DescriptionStoredRow<S>): Promise<void>
  remove(id: string): Promise<void>
  clear(): Promise<void>
  readXml(id: string): Promise<string>
  /** Subscribe to a change of whose repository this is (account, project). */
  onScopeChanged?(listener: () => void): () => void
}

/** The item the UI sees: the summary plus the row's identity. */
export type DescriptionItem<S> = S & { id: string; filename: string; loadedAt: string }
