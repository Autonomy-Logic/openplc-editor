import type {
  Architecture,
  DebugConnectionType,
  DebugTreeNode,
  FbInstanceInfo,
  Platform,
  PlcLogs,
} from '../../../../middleware/shared/ports/types'

// ---------------------------------------------------------------------------
// PLC Log Filters
// ---------------------------------------------------------------------------

export type PlcFilters = {
  levels: {
    debug: boolean
    info: boolean
    warning: boolean
    error: boolean
  }
  searchTerm: string
  timestampFormat: 'full' | 'time' | 'none'
}

// ---------------------------------------------------------------------------
// Project tree
// ---------------------------------------------------------------------------

export type WorkspaceProjectTreeLeafType =
  | 'function'
  | 'function-block'
  | 'program'
  | 'data-type'
  | 'device'
  | 'resource'
  | 'server'
  | 'remote-device'
  | 'vendor-screen'
  | 'package-manager'
  | 'library-manager'
  | 'library-manifest'
  | 'ethercat-device'
  | null

// ---------------------------------------------------------------------------
// System configuration
// ---------------------------------------------------------------------------

export type SystemConfigs = {
  OS: Platform
  arch: Architecture
  shouldUseDarkMode: boolean
  isWindowMaximized: boolean
}

// ---------------------------------------------------------------------------
// Workspace State (superset of both editor and web)
// ---------------------------------------------------------------------------

export type WorkspaceState = {
  workspace: {
    editingState: 'save-request' | 'saved' | 'unsaved' | 'initial-state'
    systemConfigs: SystemConfigs
    recent: Array<{ lastOpenedAt: string; createdAt: string; path: string; name: string }>
    isCollapsed: boolean
    isModalOpen: Array<{ modalName: string; modalState: boolean }>
    discardChanges: boolean
    selectedProjectTreeLeaf: {
      label: string
      type: WorkspaceProjectTreeLeafType
    }
    close: {
      window: boolean
      app: boolean
      appDarwin: boolean
    }
    // PLC Logs
    isPlcLogsVisible: boolean
    plcLogs: PlcLogs
    plcLogsLastId: number | null
    plcFilters: PlcFilters
    // Debug state (union of editor + web fields)
    isDebuggerVisible: boolean
    debuggerTargetIp: string | null
    debugCContent: string | null
    debugVariableIndexes: Map<string, number>
    debugBoolValues: Map<string, string>
    debugNonBoolValues: Map<string, string>
    debugForcedVariables: Map<string, boolean>
    debugTick: number
    debugVariableTree: Map<string, DebugTreeNode>
    debugExpandedNodes: Map<string, boolean>
    fbDebugInstances: Map<string, FbInstanceInfo[]>
    fbSelectedInstance: Map<string, string>
    debugLocalMd5: string | null
    debugGraphList: string[]
    debugDataStale: boolean
    debugMd5Mismatch: { runtimeMd5: string; localMd5: string } | null
    /** Active transport for the running debug session — drives the
     *  per-poll batch size and any other transport-specific behaviour.
     *  Null when no session is active. */
    debugConnectionType: DebugConnectionType | null
    /** Target's native byte order for multi-byte variable values on
     *  the wire.  Detected from the 0xDEAD sentinel in the MD5
     *  response: LE target writes the trailer as `[0xAD, 0xDE]`, BE
     *  target writes `[0xDE, 0xAD]`.  The editor's internal codecs
     *  always produce / consume little-endian bytes; the swap layer
     *  at the read / write boundaries flips on BE targets only.
     *
     *  Defaults to `'le'` because every shipped target today is LE.
     *  MD5 verification runs before any force / read transaction so
     *  the value is correct by the time any swap path executes. */
    debugTargetEndian: 'le' | 'be'
    // Project loading state
    isProjectLoading: boolean
    projectLoadingMessage: string
    /**
     * Whether the viewer has permission to persist changes to the open
     * project (e.g. they own it or have write access).  Only gates
     * operations that write to the backend — save, commit, branch
     * create/delete, stash, discard.  In-memory editing, simulation,
     * and compilation are always allowed: a viewer of a public project
     * works on a local copy and just can't push it back.  Set by
     * `handleOpenProjectResponse` from the backend `canEdit` flag;
     * absent (desktop editor / dev-local) ⇒ `true`.  Reset to `true`
     * on project close.
     */
    canEdit: boolean
  }
}

// ---------------------------------------------------------------------------
// Workspace Response
// ---------------------------------------------------------------------------

export type WorkspaceResponse = {
  ok: boolean
  title?: string
  message?: string
}

// ---------------------------------------------------------------------------
// Workspace Actions (superset of both editor and web)
// ---------------------------------------------------------------------------

export type WorkspaceActions = {
  setEditingState: (editingState: WorkspaceState['workspace']['editingState']) => void
  setRecent: (recent: WorkspaceState['workspace']['recent']) => void
  setSystemConfigs: (config: Partial<SystemConfigs>) => void
  setCloseWindow: (value: boolean) => void
  setCloseApp: (value: boolean) => void
  setCloseAppDarwin: (value: boolean) => void
  switchAppTheme: () => void
  toggleMaximizedWindow: () => void
  toggleCollapse: () => void
  toggleDiscardChanges: () => void
  setModalOpen: (modalName: string, modalState: boolean) => void
  setSelectedProjectTreeLeaf: (leaf: { label: string; type: WorkspaceProjectTreeLeafType }) => void
  clearWorkspace: () => void
  // PLC Logs
  setPlcLogsVisible: (isVisible: boolean) => void
  setPlcLogs: (logs: PlcLogs) => void
  setPlcLogsLastId: (lastId: number | null) => void
  appendPlcLogs: (newLogs: PlcLogs) => void
  clearPlcLogs: () => void
  setPlcLevelFilter: (level: 'debug' | 'info' | 'warning' | 'error', enabled: boolean) => void
  setPlcSearchTerm: (term: string) => void
  setPlcTimestampFormat: (format: 'full' | 'time' | 'none') => void
  // Debug actions
  setDebuggerVisible: (isVisible: boolean) => void
  setDebuggerTargetIp: (targetIp: string | null) => void
  setDebugCContent: (content: string | null) => void
  setDebugVariableIndexes: (indexes: Map<string, number>) => void
  setDebugBoolValues: (values: Map<string, string>) => void
  setDebugNonBoolValues: (values: Map<string, string>) => void
  setDebugForcedVariables: (forced: Map<string, boolean>) => void
  setDebugTick: (tick: number) => void
  setDebugVariableTree: (tree: Map<string, DebugTreeNode>) => void
  setDebugExpandedNodes: (expandedNodes: Map<string, boolean>) => void
  toggleDebugExpandedNode: (compositeKey: string) => void
  setFbDebugInstances: (instances: Map<string, FbInstanceInfo[]>) => void
  setFbSelectedInstance: (fbTypeName: string, key: string) => void
  setDebugLocalMd5: (md5: string | null) => void
  setDebugGraphList: (list: string[]) => void
  setDebugDataStale: (stale: boolean) => void
  setDebugMd5Mismatch: (mismatch: { runtimeMd5: string; localMd5: string } | null) => void
  setDebugConnectionType: (connectionType: DebugConnectionType | null) => void
  setDebugTargetEndian: (endian: 'le' | 'be') => void
  clearDebugState: () => void
  clearFbDebugContext: () => void
  removeDebugVariable: (compositeKey: string) => void
  // Project loading
  setProjectLoading: (isLoading: boolean, message?: string) => void
  // Persist-permission flag (backend write access on the open project)
  setCanEdit: (value: boolean) => void
}

export type WorkspaceSlice = WorkspaceState & {
  workspaceActions: WorkspaceActions
}
