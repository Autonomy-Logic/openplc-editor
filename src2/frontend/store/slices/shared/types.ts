import type { PLCBody, PLCDataType, PLCVariable } from '../../../../middleware/shared/ports/types'
import type { ConsoleSlice } from '../console'
import type { EditorSlice } from '../editor'
import type { FileSlice } from '../file'
import type { LibrarySlice } from '../library'
import type { ModalSlice } from '../modal'
import type { ProjectSlice } from '../project'
import type { SearchSlice } from '../search'
import type { TabsSlice } from '../tabs'
import type { WorkspaceSlice } from '../workspace'

// ---------------------------------------------------------------------------
// Root state type for shared slice (it orchestrates across all slices)
// ---------------------------------------------------------------------------

export type SharedRootState = ProjectSlice &
  FileSlice &
  EditorSlice &
  TabsSlice &
  LibrarySlice &
  WorkspaceSlice &
  ModalSlice &
  SearchSlice &
  ConsoleSlice &
  SharedSlice

// ---------------------------------------------------------------------------
// Response type
// ---------------------------------------------------------------------------

export type SharedResponse = {
  ok: boolean
  title?: string
  message?: string
}

// ---------------------------------------------------------------------------
// POU History (undo/redo)
// ---------------------------------------------------------------------------

export type PouHistorySnapshot = {
  variables: PLCVariable[]
  body: unknown
  globalVariables?: PLCVariable[]
}

export type PouHistory = {
  past: PouHistorySnapshot[]
  future: PouHistorySnapshot[]
}

// ---------------------------------------------------------------------------
// Shared Slice Actions
// ---------------------------------------------------------------------------

export type PouActions = {
  create: (args: {
    type: 'program' | 'function' | 'function-block'
    name: string
    language: 'il' | 'st' | 'ld' | 'sfc' | 'fbd' | 'python' | 'cpp'
  }) => SharedResponse
  deleteRequest: (name: string) => void
  delete: (name: string) => SharedResponse
  rename: (oldName: string, newName: string) => SharedResponse
  duplicate: (sourceName: string, newName: string) => SharedResponse
}

export type DatatypeActions = {
  create: (args: {
    name: string
    derivation: 'array' | 'enumerated' | 'structure'
  }) => SharedResponse
  deleteRequest: (name: string) => void
  delete: (name: string) => SharedResponse
  rename: (oldName: string, newName: string) => SharedResponse
  duplicate: (sourceName: string, newName: string) => SharedResponse
}

export type ServerActions = {
  deleteRequest: (name: string) => void
  delete: (name: string) => SharedResponse
  rename: (oldName: string, newName: string) => SharedResponse
}

export type RemoteDeviceActions = {
  deleteRequest: (name: string) => void
  delete: (name: string) => SharedResponse
  rename: (oldName: string, newName: string) => SharedResponse
}

export type SnapshotActions = {
  pushToHistory: (pouName: string, snapshot: PouHistorySnapshot) => void
  undo: (pouName: string) => void
  redo: (pouName: string) => void
}

export type SharedSlice = {
  undoRedo: Record<string, PouHistory>
  pouActions: PouActions
  datatypeActions: DatatypeActions
  serverActions: ServerActions
  remoteDeviceActions: RemoteDeviceActions
  snapshotActions: SnapshotActions
}
