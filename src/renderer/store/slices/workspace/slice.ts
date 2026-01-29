import type { DebugTreeNode, FbInstanceInfo } from '@root/types/debugger'
import { isV4Logs, LOG_BUFFER_CAP, PlcLogs } from '@root/types/PLC/runtime-logs'
import { produce } from 'immer'
import { StateCreator } from 'zustand'

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
    isDebuggerVisible: false,
    debuggerTargetIp: null,
    debugVariableIndexes: new Map(),
    debugVariableValues: new Map(),
    debugForcedVariables: new Map(),
    debugVariableTree: new Map(),
    debugExpandedNodes: new Map(),
    fbDebugInstances: new Map(),
    fbSelectedInstance: new Map(),
    isPlcLogsVisible: false,
    plcLogs: '',
    plcLogsLastId: null,
    plcFilters: {
      levels: { debug: true, info: true, warning: true, error: true },
      searchTerm: '',
      timestampFormat: 'full',
    },
    close: {
      window: false,
      app: false,
      appDarwin: false,
    },
    selectedProjectTreeLeaf: {
      label: '',
      type: null,
    },
  },

  workspaceActions: {
    setEditingState: (editingState): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.editingState = editingState
        }),
      )
    },
    setSystemConfigs: (systemConfigsData): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.systemConfigs = systemConfigsData
        }),
      )
    },
    setRecent: (recent): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.recent = recent
        }),
      )
    },
    setCloseApp: (value): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.close.app = value
        }),
      )
    },
    setCloseAppDarwin: (value): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.close.appDarwin = value
        }),
      )
    },
    setCloseWindow: (value): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.close.window = value
        }),
      )
    },

    switchAppTheme: (): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.systemConfigs.shouldUseDarkMode = !workspace.systemConfigs.shouldUseDarkMode
        }),
      )
    },
    toggleMaximizedWindow: (): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.systemConfigs.isWindowMaximized = !workspace.systemConfigs.isWindowMaximized
        }),
      )
    },
    toggleCollapse: (): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.isCollapsed = !workspace.isCollapsed
        }),
      )
    },
    toggleDiscardChanges: (): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.discardChanges = !workspace.discardChanges
        }),
      )
    },
    setModalOpen: (modalName: string, modalState: boolean): void => {
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
    setSelectedProjectTreeLeaf: (selectedProjectTreeLeaf): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.selectedProjectTreeLeaf = selectedProjectTreeLeaf
        }),
      )
    },
    clearWorkspace: (): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.editingState = 'initial-state'
          workspace.selectedProjectTreeLeaf = {
            label: '',
            type: null,
          }
        }),
      )
    },
    setDebuggerVisible: (isVisible: boolean): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.isDebuggerVisible = isVisible
        }),
      )
    },
    setDebuggerTargetIp: (targetIp: string | null): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.debuggerTargetIp = targetIp
        }),
      )
    },
    setDebugVariableIndexes: (indexes: Map<string, number>): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.debugVariableIndexes = indexes
        }),
      )
    },
    setDebugVariableValues: (values: Map<string, string>): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.debugVariableValues = values
        }),
      )
    },
    setDebugForcedVariables: (forced: Map<string, boolean>): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.debugForcedVariables = forced
        }),
      )
    },
    setDebugVariableTree: (tree: Map<string, DebugTreeNode>): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.debugVariableTree = tree
        }),
      )
    },
    setDebugExpandedNodes: (expandedNodes: Map<string, boolean>): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.debugExpandedNodes = expandedNodes
        }),
      )
    },
    toggleDebugExpandedNode: (compositeKey: string): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          const currentValue = workspace.debugExpandedNodes.get(compositeKey) ?? false
          workspace.debugExpandedNodes.set(compositeKey, !currentValue)
        }),
      )
    },
    setFbDebugInstances: (instances: Map<string, FbInstanceInfo[]>): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.fbDebugInstances = instances
        }),
      )
    },
    setFbSelectedInstance: (fbTypeName: string, key: string): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.fbSelectedInstance.set(fbTypeName, key)
        }),
      )
    },
    clearFbDebugContext: (): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.fbDebugInstances = new Map()
          workspace.fbSelectedInstance = new Map()
        }),
      )
    },
    setPlcLogsVisible: (isVisible: boolean): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.isPlcLogsVisible = isVisible
        }),
      )
    },
    setPlcLogs: (logs: PlcLogs): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.plcLogs = logs
        }),
      )
    },
    setPlcLogsLastId: (lastId: number | null): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.plcLogsLastId = lastId
        }),
      )
    },
    appendPlcLogs: (newLogs: PlcLogs): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          if (isV4Logs(newLogs) && isV4Logs(workspace.plcLogs)) {
            const combined = [...workspace.plcLogs, ...newLogs]
            if (combined.length > LOG_BUFFER_CAP) {
              workspace.plcLogs = combined.slice(-LOG_BUFFER_CAP)
            } else {
              workspace.plcLogs = combined
            }
          } else if (typeof newLogs === 'string' && typeof workspace.plcLogs === 'string') {
            workspace.plcLogs = workspace.plcLogs + newLogs
          } else {
            workspace.plcLogs = newLogs
          }
        }),
      )
    },
    clearPlcLogs: (): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.plcLogs = ''
          workspace.plcLogsLastId = null
        }),
      )
    },
    setPlcLevelFilter: (level: 'debug' | 'info' | 'warning' | 'error', enabled: boolean): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.plcFilters.levels[level] = enabled
        }),
      )
    },
    setPlcSearchTerm: (term: string): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.plcFilters.searchTerm = term
        }),
      )
    },
    setPlcTimestampFormat: (format: 'full' | 'time' | 'none'): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.plcFilters.timestampFormat = format
        }),
      )
    },
  },
})

export { createWorkspaceSlice }
