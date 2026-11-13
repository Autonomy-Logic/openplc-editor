import type { HmiElementKind } from '../../../../middleware/shared/utils/hmi/references'
import type { HistoryMerge, SourceHistory } from '../../../../middleware/shared/utils/hmi/source-history'

export type HmiDesignerView = 'design' | 'code'

/** What the designer keeps for one screen or widget block while the project is open. */
export interface HmiDesignerEntry {
  history: SourceHistory
  view: HmiDesignerView
  /** Device preset id (`HMI_DEVICE_PRESETS`). */
  device: string
  /** Canvas zoom; null fits the device to the canvas. */
  zoom: number | null
  /** Selected elements, by name. */
  selection: string[]
  /** The last source that parsed, shown while the code does not. */
  lastValidSource: string | null
}

export type HmiDesignerState = Record<string, HmiDesignerEntry>

export interface HmiDesignerActions {
  /**
   * Puts an edited source in place: records the step for undo (merged with the previous one of the same key), updates
   * the project and marks the element unsaved.
   */
  applySource: (kind: HmiElementKind, name: string, source: string, merge?: HistoryMerge) => void
  /** Returns false when there is nothing to undo. */
  undo: (kind: HmiElementKind, name: string) => boolean
  redo: (kind: HmiElementKind, name: string) => boolean
  setView: (kind: HmiElementKind, name: string, view: HmiDesignerView) => void
  setDevice: (kind: HmiElementKind, name: string, device: string) => void
  setZoom: (kind: HmiElementKind, name: string, zoom: number | null) => void
  select: (kind: HmiElementKind, name: string, selection: string[]) => void
  setLastValidSource: (kind: HmiElementKind, name: string, source: string) => void
  /** Follows a renamed screen or widget block. */
  renameEntry: (kind: HmiElementKind, oldName: string, newName: string) => void
  forgetEntry: (kind: HmiElementKind, name: string) => void
  clear: () => void
}

export interface HmiDesignerSlice {
  hmiDesigner: HmiDesignerState
  hmiDesignerActions: HmiDesignerActions
}
