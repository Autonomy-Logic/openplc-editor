import type { PLCDataType, PLCInstance, PLCTask, PLCVariable } from '../../../../middleware/shared/ports/types'
import type { ZodFBDFlowType } from '../fbd'
import type { ZodLadderFlowType } from '../ladder'

// ---------------------------------------------------------------------------
// History snapshot — captures the complete state of a POU for undo/redo
// ---------------------------------------------------------------------------

export type HistorySnapshot = {
  variables: PLCVariable[]
  body: unknown
  ladderFlow?: ZodLadderFlowType
  fbdFlow?: ZodFBDFlowType
  globalVariables?: PLCVariable[]
  tasks?: PLCTask[]
  instances?: PLCInstance[]
  dataTypes?: PLCDataType[]
}

// ---------------------------------------------------------------------------
// Per-POU history stacks
// ---------------------------------------------------------------------------

export type PouHistoryBucket = {
  past: HistorySnapshot[]
  future: HistorySnapshot[]
  /** Depth of the past stack when the file was last saved. null = never saved or diverged. */
  savedAtDepth: number | null
}

export type HistoryState = Record<string, PouHistoryBucket>

// ---------------------------------------------------------------------------
// History actions
// ---------------------------------------------------------------------------

export type HistoryActions = {
  addPastHistory: (pouName: string, snapshot: HistorySnapshot) => void
  addFutureHistory: (pouName: string, snapshot: HistorySnapshot) => void
  popPastHistory: (pouName: string) => HistorySnapshot | undefined
  popFutureHistory: (pouName: string) => HistorySnapshot | undefined
  undo: (pouName: string) => void
  redo: (pouName: string) => void
  clearHistory: () => void
}

// ---------------------------------------------------------------------------
// History slice
// ---------------------------------------------------------------------------

export type HistorySlice = {
  history: HistoryState
  historyActions: HistoryActions
}
