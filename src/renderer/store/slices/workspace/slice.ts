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
  },
})

export { createWorkspaceSlice }
