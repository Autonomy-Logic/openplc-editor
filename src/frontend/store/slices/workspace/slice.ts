import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { DebugTreeNode, FbInstanceInfo, PlcLogs } from '../../../../middleware/shared/ports/types'
import { isV4Logs, LOG_BUFFER_CAP } from '../../../../middleware/shared/ports/types'
import type { WorkspaceSlice } from './types'

const createWorkspaceSlice: StateCreator<WorkspaceSlice, [], [], WorkspaceSlice> = (setState) => ({
  workspace: {
    editingState: 'initial-state',
    systemConfigs: {
      OS: '',
      arch: '',
      shouldUseDarkMode: false,
      isWindowMaximized: false,
    },
    recent: [],
    isCollapsed: false,
    isModalOpen: [],
    discardChanges: false,
    selectedProjectTreeLeaf: {
      label: '',
      type: null,
    },
    close: {
      window: false,
      app: false,
      appDarwin: false,
    },
    // PLC Logs
    isPlcLogsVisible: false,
    plcLogs: '',
    plcLogsLastId: null,
    plcFilters: {
      levels: { debug: true, info: true, warning: true, error: true },
      searchTerm: '',
      timestampFormat: 'full',
    },
    // Debug state
    isDebuggerVisible: false,
    debuggerTargetIp: null,
    debugCContent: null,
    debugVariableIndexes: new Map(),
    debugBoolValues: new Map(),
    debugNonBoolValues: new Map(),
    debugForcedVariables: new Map(),
    debugTick: 0,
    debugVariableTree: new Map(),
    debugExpandedNodes: new Map(),
    fbDebugInstances: new Map(),
    fbSelectedInstance: new Map(),
    debugLocalMd5: null,
    debugGraphList: [],
    debugDataStale: false,
    debugMd5Mismatch: null,
    debugConnectionType: null,
    debugTargetEndian: 'le',
    // Project loading state
    isProjectLoading: false,
    projectLoadingMessage: '',
    // Persist-permission flag (backend write access on the open project)
    canEdit: true,
  },

  workspaceActions: {
    setEditingState: (editingState) => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.editingState = editingState
        }),
      )
    },
    setSystemConfigs: (systemConfigsData) => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.systemConfigs = { ...workspace.systemConfigs, ...systemConfigsData }
        }),
      )
    },
    setRecent: (recent) => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.recent = recent
        }),
      )
    },
    setCloseApp: (value) => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.close.app = value
        }),
      )
    },
    setCloseAppDarwin: (value) => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.close.appDarwin = value
        }),
      )
    },
    setCloseWindow: (value) => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.close.window = value
        }),
      )
    },
    switchAppTheme: () => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.systemConfigs.shouldUseDarkMode = !workspace.systemConfigs.shouldUseDarkMode
        }),
      )
    },
    toggleMaximizedWindow: () => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.systemConfigs.isWindowMaximized = !workspace.systemConfigs.isWindowMaximized
        }),
      )
    },
    toggleCollapse: () => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.isCollapsed = !workspace.isCollapsed
        }),
      )
    },
    toggleDiscardChanges: () => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.discardChanges = !workspace.discardChanges
        }),
      )
    },
    setModalOpen: (modalName: string, modalState: boolean) => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          const modalIndex = workspace.isModalOpen.findIndex((modal) => modal.modalName === modalName)
          if (modalIndex !== -1) {
            workspace.isModalOpen[modalIndex].modalState = modalState
          } else {
            workspace.isModalOpen.push({ modalName, modalState })
          }
        }),
      )
    },
    setSelectedProjectTreeLeaf: (selectedProjectTreeLeaf) => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.selectedProjectTreeLeaf = selectedProjectTreeLeaf
        }),
      )
    },
    clearWorkspace: () => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.editingState = 'initial-state'
          workspace.selectedProjectTreeLeaf = { label: '', type: null }
          workspace.isDebuggerVisible = false
          workspace.debuggerTargetIp = null
          workspace.debugCContent = null
          workspace.debugVariableIndexes = new Map()
          workspace.debugBoolValues = new Map()
          workspace.debugNonBoolValues = new Map()
          workspace.debugForcedVariables = new Map()
          workspace.debugTick = 0
          workspace.debugVariableTree = new Map()
          workspace.debugExpandedNodes = new Map()
          workspace.fbDebugInstances = new Map()
          workspace.fbSelectedInstance = new Map()
          workspace.debugLocalMd5 = null
          workspace.debugGraphList = []
          workspace.debugDataStale = false
          workspace.debugMd5Mismatch = null
          workspace.debugConnectionType = null
          workspace.debugTargetEndian = 'le'
          workspace.isPlcLogsVisible = false
          workspace.plcLogs = ''
          workspace.plcLogsLastId = null
          workspace.plcFilters = {
            levels: { debug: true, info: true, warning: true, error: true },
            searchTerm: '',
            timestampFormat: 'full',
          }
          workspace.isProjectLoading = false
          workspace.projectLoadingMessage = ''
          workspace.canEdit = true
        }),
      )
    },
    // PLC Logs
    setPlcLogsVisible: (isVisible: boolean) => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.isPlcLogsVisible = isVisible
        }),
      )
    },
    setPlcLogs: (logs: PlcLogs) => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.plcLogs = logs
        }),
      )
    },
    setPlcLogsLastId: (lastId: number | null) => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.plcLogsLastId = lastId
        }),
      )
    },
    appendPlcLogs: (newLogs: PlcLogs) => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          if (isV4Logs(newLogs) && isV4Logs(workspace.plcLogs)) {
            const combined = [...workspace.plcLogs, ...newLogs]
            workspace.plcLogs = combined.length > LOG_BUFFER_CAP ? combined.slice(-LOG_BUFFER_CAP) : combined
          } else if (typeof newLogs === 'string' && typeof workspace.plcLogs === 'string') {
            workspace.plcLogs = workspace.plcLogs + newLogs
          } else {
            workspace.plcLogs = newLogs
          }
        }),
      )
    },
    clearPlcLogs: () => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.plcLogs = ''
          workspace.plcLogsLastId = null
        }),
      )
    },
    setPlcLevelFilter: (level: 'debug' | 'info' | 'warning' | 'error', enabled: boolean) => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.plcFilters.levels[level] = enabled
        }),
      )
    },
    setPlcSearchTerm: (term: string) => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.plcFilters.searchTerm = term
        }),
      )
    },
    setPlcTimestampFormat: (format: 'full' | 'time' | 'none') => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.plcFilters.timestampFormat = format
        }),
      )
    },
    // Debug actions
    setDebuggerVisible: (isVisible: boolean) => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.isDebuggerVisible = isVisible
        }),
      )
    },
    setDebuggerTargetIp: (targetIp: string | null) => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.debuggerTargetIp = targetIp
        }),
      )
    },
    setDebugCContent: (content: string | null) => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.debugCContent = content
        }),
      )
    },
    setDebugVariableIndexes: (indexes: Map<string, number>) => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.debugVariableIndexes = indexes
        }),
      )
    },
    setDebugBoolValues: (values: Map<string, string>) => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          for (const [key, val] of values) {
            workspace.debugBoolValues.set(key, val)
          }
        }),
      )
    },
    setDebugNonBoolValues: (values: Map<string, string>) => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          for (const [key, val] of values) {
            workspace.debugNonBoolValues.set(key, val)
          }
        }),
      )
    },
    setDebugForcedVariables: (forced: Map<string, boolean>) => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.debugForcedVariables = forced
        }),
      )
    },
    setDebugTick: (tick: number) => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.debugTick = tick
        }),
      )
    },
    setDebugVariableTree: (tree: Map<string, DebugTreeNode>) => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.debugVariableTree = tree
        }),
      )
    },
    setDebugExpandedNodes: (expandedNodes: Map<string, boolean>) => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.debugExpandedNodes = expandedNodes
        }),
      )
    },
    toggleDebugExpandedNode: (compositeKey: string) => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          const currentValue = workspace.debugExpandedNodes.get(compositeKey) ?? false
          workspace.debugExpandedNodes.set(compositeKey, !currentValue)
        }),
      )
    },
    setFbDebugInstances: (instances: Map<string, FbInstanceInfo[]>) => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.fbDebugInstances = instances
        }),
      )
    },
    setFbSelectedInstance: (fbTypeName: string, key: string) => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.fbSelectedInstance.set(fbTypeName, key)
        }),
      )
    },
    setDebugLocalMd5: (md5: string | null) => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.debugLocalMd5 = md5
        }),
      )
    },
    setDebugGraphList: (list: string[]) => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.debugGraphList = list
        }),
      )
    },
    setDebugDataStale: (stale: boolean) => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.debugDataStale = stale
        }),
      )
    },
    setDebugMd5Mismatch: (mismatch: { runtimeMd5: string; localMd5: string } | null) => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.debugMd5Mismatch = mismatch
        }),
      )
    },
    setDebugConnectionType: (connectionType) => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.debugConnectionType = connectionType
        }),
      )
    },
    setDebugTargetEndian: (endian) => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.debugTargetEndian = endian
        }),
      )
    },
    clearDebugState: () => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.isDebuggerVisible = false
          workspace.debuggerTargetIp = null
          workspace.debugCContent = null
          workspace.debugVariableIndexes = new Map()
          workspace.debugBoolValues = new Map()
          workspace.debugNonBoolValues = new Map()
          workspace.debugForcedVariables = new Map()
          workspace.debugTick = 0
          workspace.debugVariableTree = new Map()
          workspace.debugExpandedNodes = new Map()
          workspace.fbDebugInstances = new Map()
          workspace.fbSelectedInstance = new Map()
          workspace.debugLocalMd5 = null
          workspace.debugGraphList = []
          workspace.debugDataStale = false
          workspace.debugMd5Mismatch = null
          workspace.debugConnectionType = null
          workspace.debugTargetEndian = 'le'
        }),
      )
    },
    clearFbDebugContext: () => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.fbDebugInstances = new Map()
          workspace.fbSelectedInstance = new Map()
        }),
      )
    },
    removeDebugVariable: (compositeKey: string) => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.debugVariableIndexes.delete(compositeKey)
          workspace.debugBoolValues.delete(compositeKey)
          workspace.debugNonBoolValues.delete(compositeKey)
          workspace.debugForcedVariables.delete(compositeKey)
          workspace.debugVariableTree.delete(compositeKey)
          workspace.debugExpandedNodes.delete(compositeKey)
        }),
      )
    },
    setProjectLoading: (isLoading: boolean, message?: string) => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.isProjectLoading = isLoading
          workspace.projectLoadingMessage = message ?? ''
        }),
      )
    },
    setCanEdit: (value: boolean) => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.canEdit = value
        }),
      )
    },
  },
})

export { createWorkspaceSlice }
