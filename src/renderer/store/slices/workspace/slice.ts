import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { WorkspaceSlice } from './types'

const createWorkspaceSlice: StateCreator<WorkspaceSlice, [], [], WorkspaceSlice> = (setState) => ({
  workspace: {
    editingState: 'unsaved',
    systemConfigs: {
      OS: '',
      arch: '',
      shouldUseDarkMode: false,
      isWindowMaximized: false,
    },
    recents: [],
    isCollapsed: false,
    isModalOpen: [],
    discardChanges: false,
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
  },
})

export { createWorkspaceSlice }
