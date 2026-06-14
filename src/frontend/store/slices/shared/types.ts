import type {
  DeviceConfiguration,
  DevicePin,
  PLCProjectData,
  PLCVariable,
  ProjectMeta,
} from '../../../../middleware/shared/ports/types'
import type { AISlice } from '../ai'
import type { ConsoleSlice } from '../console'
import type { DeviceSlice } from '../device'
import type { EditorSlice } from '../editor'
import type { FBDFlowSlice } from '../fbd'
import type { FileSlice } from '../file'
import type { HistorySlice } from '../history'
import type { LadderFlowSlice } from '../ladder'
import type { LibrarySlice } from '../library'
import type { ModalSlice } from '../modal'
import type { ProjectSlice } from '../project'
import type { SearchSlice } from '../search'
import type { TabsSlice } from '../tabs'
import type { VersionControlSlice } from '../version-control'
import type { WorkspaceSlice } from '../workspace'

// ---------------------------------------------------------------------------
// Root state type for shared slice (it orchestrates across all slices)
// ---------------------------------------------------------------------------

export type SharedRootState = AISlice &
  ProjectSlice &
  FileSlice &
  EditorSlice &
  TabsSlice &
  LibrarySlice &
  WorkspaceSlice &
  ModalSlice &
  SearchSlice &
  ConsoleSlice &
  DeviceSlice &
  FBDFlowSlice &
  LadderFlowSlice &
  HistorySlice &
  VersionControlSlice &
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
  ladderFlow?: unknown
  fbdFlow?: unknown
}

export type PouHistory = {
  past: PouHistorySnapshot[]
  future: PouHistorySnapshot[]
  /** Depth of the past stack when the file was last saved. null = never saved or diverged. */
  savedAtDepth: number | null
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
  create: (args: { name: string; derivation: 'array' | 'enumerated' | 'structure' }) => SharedResponse
  deleteRequest: (name: string) => void
  delete: (name: string) => SharedResponse
  rename: (oldName: string, newName: string) => SharedResponse
  duplicate: (sourceName: string, newName: string) => SharedResponse
}

export type ServerActions = {
  create: (args: { name: string; protocol: 'modbus-tcp' | 's7comm' | 'ethernet-ip' | 'opcua' }) => SharedResponse
  deleteRequest: (name: string) => void
  delete: (name: string) => SharedResponse
  rename: (oldName: string, newName: string) => SharedResponse
}

export type RemoteDeviceActions = {
  create: (args: { name: string; protocol: 'modbus-tcp' | 'ethernet-ip' | 'ethercat' | 'profinet' }) => SharedResponse
  deleteRequest: (name: string) => void
  delete: (name: string) => SharedResponse
  rename: (oldName: string, newName: string) => SharedResponse
}

export type EtherCATDeviceActions = {
  delete: (busName: string, deviceId: string) => SharedResponse
  rename: (busName: string, deviceId: string, newName: string) => SharedResponse
}

export type SnapshotActions = {
  pushToHistory: (pouName: string, snapshot: PouHistorySnapshot) => void
  markSaved: (pouName: string) => void
  markAllSaved: () => void
  undo: (pouName: string) => void
  redo: (pouName: string) => void
}

export type OpenProjectResponseData = {
  meta: ProjectMeta
  projectData: PLCProjectData
  deviceConfiguration?: DeviceConfiguration
  /** Pin mappings parsed from disk. The store accepts both shapes
   *  (per-board dict and legacy flat array); see
   *  `DeviceActions.setDeviceDefinitions` for the migration. */
  devicePinMapping?: DevicePin[] | Record<string, DevicePin[]>
  /** Warnings from parsing (e.g. dropped files that failed validation). */
  warnings?: string[]
  /**
   * Edit permission flag forwarded from `ProjectResponse.data.canEdit`.
   * `false` puts the workspace in read-only mode; `true` / `undefined`
   * keep it fully editable.  Absent ⇒ desktop editor or dev-local; both
   * have no remote permission concept so the editor stays unrestricted.
   */
  canEdit?: boolean
}

export type SharedWorkspaceActions = {
  /** Mark a file as unsaved and set workspace editingState to 'unsaved'. */
  handleFileAndWorkspaceSavedState: (name: string) => void
  /** Check save state, show modal if unsaved, or close the file. */
  closeFile: (name: string) => { success: boolean }
  /** Remove a tab and select the next one. Does NOT check save state. */
  forceCloseFile: (name: string) => { success: boolean }
  /**
   * Close project: checks save state, shows save-changes modal if unsaved,
   * or clears all state if saved. Returns `{ pendingConfirmation: true }`
   * when the modal was opened so the caller can defer post-close work
   * (e.g. host navigation) until the modal resolves.
   */
  closeProject: () => { pendingConfirmation: boolean }
  /** Reset all slice state for project close. */
  clearStatesOnCloseProject: () => void
  /**
   * Populate store with project data returned from a ProjectPort open call.
   * Sets project state, device config, files, libraries, flows, and opens main POU tab.
   */
  handleOpenProjectResponse: (data: OpenProjectResponseData) => void
}

export type SharedSlice = {
  undoRedo: Record<string, PouHistory>
  pouActions: PouActions
  datatypeActions: DatatypeActions
  serverActions: ServerActions
  remoteDeviceActions: RemoteDeviceActions
  ethercatDeviceActions: EtherCATDeviceActions
  snapshotActions: SnapshotActions
  sharedWorkspaceActions: SharedWorkspaceActions
}
