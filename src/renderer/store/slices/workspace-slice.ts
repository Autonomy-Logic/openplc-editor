import { IFunction, IFunctionBlock, IProgram, IProject } from '@root/types/PLC/index'
import { produce } from 'immer'
import { StateCreator } from 'zustand'

type IPouDTO =
  | {
      type: 'program'
      data: IProgram
    }
  | {
      type: 'function'
      data: IFunction
    }
  | {
      type: 'function-block'
      data: IFunctionBlock
    }

type IWorkspaceState = {
  projectName: string
  projectPath: string
  projectData: IProject
  editingState: 'save-request' | 'saved' | 'unsaved'
  systemConfigs: {
    OS: 'win32' | 'linux' | 'darwin' | ''
    arch: 'x64' | 'arm' | ''
    shouldUseDarkMode: boolean
  }
}

type ICreatePouRes = {
  ok: boolean
  message?: string
}

type IWorkspaceActions = {
  setEditingState: (editingState: IWorkspaceState['editingState']) => void
  setUserWorkspace: (userWorkspaceState: Omit<IWorkspaceState, 'systemConfigs'>) => void
  setSystemConfigs: (systemConfigs: IWorkspaceState['systemConfigs']) => void
  switchAppTheme: () => void
  updateProjectName: (projectName: string) => void
  updateProjectPath: (projectPath: string) => void
  createPou: (pouToBeCreated: IPouDTO) => ICreatePouRes
  updatePou: (dataToBeUpdated: { name: string; content: string }) => void
  deletePou: (pouToBeDeleted: string) => void
}

type IWorkspaceSlice = IWorkspaceState & {
  workspaceActions: IWorkspaceActions
}

const createWorkspaceSlice: StateCreator<IWorkspaceSlice, [], [], IWorkspaceSlice> = (setState) => ({
  editingState: 'unsaved',
  projectName: '',
  projectPath: '',
  projectData: {
    dataTypes: [],
    pous: [],
    globalVariables: [],
  },
  systemConfigs: {
    OS: '',
    arch: '',
    shouldUseDarkMode: false,
  },

  workspaceActions: {
    setEditingState: (editingState: IWorkspaceState['editingState']): void => {
      setState(
        produce((slice: IWorkspaceSlice) => {
          slice.editingState = editingState
        }),
      )
    },
    setUserWorkspace: (userWorkspaceState: Omit<IWorkspaceState, 'systemConfigs'>): void => {
      setState(
        produce((slice: IWorkspaceSlice) => {
          const { projectPath, projectName, projectData } = userWorkspaceState
          slice.projectPath = projectPath
          slice.projectName = projectName
          slice.projectData = projectData
        }),
      )
    },
    setSystemConfigs: (systemConfigsData: IWorkspaceState['systemConfigs']): void => {
      setState(
        produce((slice: IWorkspaceSlice) => {
          slice.systemConfigs = systemConfigsData
        }),
      )
    },
    switchAppTheme: (): void => {
      setState(
        produce((slice: IWorkspaceSlice) => {
          slice.systemConfigs.shouldUseDarkMode = !slice.systemConfigs.shouldUseDarkMode
        }),
      )
    },
    updateProjectName: (projectName: string): void => {
      setState(
        produce((slice: IWorkspaceSlice) => {
          slice.projectName = projectName
        }),
      )
    },
    updateProjectPath: (projectPath: string): void => {
      setState(
        produce((slice: IWorkspaceSlice) => {
          slice.projectPath = projectPath
        }),
      )
    },
    createPou: (pouToBeCreated: IPouDTO): ICreatePouRes => {
      let response: ICreatePouRes = { ok: false, message: 'Internal error' }
      setState(
        produce((slice: IWorkspaceSlice) => {
          const pouExists = slice.projectData.pous.find((pou) => {
            return pou.data.name === pouToBeCreated.data.name
          })
          if (!pouExists) {
            slice.projectData.pous.push(pouToBeCreated)
            response = { ok: true, message: 'Pou created successfully' }
          } else {
            response = { ok: false, message: 'Pou already exists' }
          }
        }),
      )
      return response
    },
    updatePou: (dataToBeUpdated: { name: string; content: string }): void => {
      setState(
        produce((slice: IWorkspaceSlice) => {
          const draft = slice.projectData.pous.find((pou) => {
            return pou.data.name === dataToBeUpdated.name
          })
          if (draft) draft.data.body = dataToBeUpdated.content
        }),
      )
    },
    deletePou: (pouToBeDeleted: string): void => {
      setState(
        produce((slice: IWorkspaceSlice) => {
          slice.projectData.pous = slice.projectData.pous.filter((pou) => pou.data.name !== pouToBeDeleted)
        }),
      )
    },
  },
})

export { createWorkspaceSlice, type IWorkspaceSlice }
