/**
 * Undo and redo of a screen or widget block across the designer and the code view: both change the same source, so a
 * step is a source snapshot. Steps of one kind made close together (typing, dragging a value) merge into one. The
 * history is plain data, kept in the store; these functions return a new one.
 */

export interface HistoryMerge {
  /** Steps with the same key merge while each comes within `windowMs` of the previous one. */
  key: string
  at: number
  windowMs?: number
}

export interface SourceHistory {
  past: string[]
  future: string[]
  /** The last recorded step's merge key and time; null after an undo, a redo or a step without one. */
  lastMerge: { key: string; at: number } | null
}

export const HISTORY_LIMIT = 200
const MERGE_WINDOW_MS = 1000

export const emptyHistory = (): SourceHistory => ({ past: [], future: [], lastMerge: null })

/** The history after an edit took the source from `previous` to `next`; unchanged when they are equal. */
export function recordStep(
  history: SourceHistory,
  previous: string,
  next: string,
  merge?: HistoryMerge,
  limit = HISTORY_LIMIT,
): SourceHistory {
  if (previous === next) return history
  const merging =
    merge !== undefined &&
    history.lastMerge !== null &&
    history.lastMerge.key === merge.key &&
    merge.at - history.lastMerge.at <= (merge.windowMs ?? MERGE_WINDOW_MS) &&
    history.past.length > 0
  const past = merging ? history.past : [...history.past, previous].slice(-limit)
  return { past, future: [], lastMerge: merge ? { key: merge.key, at: merge.at } : null }
}

/** The source before the last step and the history after undoing it; null when there is nothing to undo. */
export function undoStep(history: SourceHistory, current: string): { source: string; history: SourceHistory } | null {
  const source = history.past.at(-1)
  if (source === undefined) return null
  return { source, history: { past: history.past.slice(0, -1), future: [...history.future, current], lastMerge: null } }
}

/** The source of the step undone last and the history after redoing it; null when there is nothing to redo. */
export function redoStep(history: SourceHistory, current: string): { source: string; history: SourceHistory } | null {
  const source = history.future.at(-1)
  if (source === undefined) return null
  return { source, history: { past: [...history.past, current], future: history.future.slice(0, -1), lastMerge: null } }
}
