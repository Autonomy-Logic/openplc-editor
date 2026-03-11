import type { DebugTreeNode, FbInstanceInfo, PlcLogs, Platform, Architecture } from '../../../providers/platform/ports/types'

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
    debugVariableValues: Map<string, string>
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
  setSystemConfigs: (config: SystemConfigs) => void
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
  setDebugVariableValues: (values: Map<string, string>) => void
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
  clearDebugState: () => void
  clearFbDebugContext: () => void
  removeDebugVariable: (compositeKey: string) => void
}

export type WorkspaceSlice = WorkspaceState & {
  workspaceActions: WorkspaceActions
}
