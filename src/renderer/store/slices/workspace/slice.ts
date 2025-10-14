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
    debugVariableIndexes: new Map(),
    debugVariableValues: new Map(),
    close: {
      window: false,
      app: false,
      appDarwin: false,
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
    setDebuggerVisible: (isVisible: boolean): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.isDebuggerVisible = isVisible
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
  },
})

export { createWorkspaceSlice }
