import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { WorkspaceSlice } from './types'

const createWorkspaceSlice: StateCreator<WorkspaceSlice, [], [], WorkspaceSlice> = (setState) => ({
  workspace: {
    editingState: 'unsaved',
    dirPath: '',
    systemConfigs: {
      OS: '',
      arch: '',
      shouldUseDarkMode: false,
      isWindowMaximized: false,
    },
    recents: [],
    isCollapsed: false,
    isModalOpen: [],
  },

  workspaceActions: {
    setEditingState: (editingState): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.editingState = editingState
        }),
      )
    },
    setDirPath: (dirPath): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.dirPath = dirPath
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
    setRecents: (recents): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.recents = recents
          console.log(workspace.recents)
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

    setModalOpen: (modalName: string, modalState: boolean): void => {
      console.log(modalName, modalState)
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
  },
})

export { createWorkspaceSlice }
