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
  editingState: 'working' | 'saved' | 'unsaved'
  projectName: string
  projectPath: string
  systemConfigs: {
    OS: 'win32' | 'linux' | 'darwin' | ''
    arch: 'x64' | 'arm' | ''
    shouldUseDarkMode: boolean
  }
  projectData: IProject
  createdAt: string
  updatedAt: string
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

type IWorkspaceSlice = {
  workspaceState: IWorkspaceState
  workspaceActions: IWorkspaceActions
}

const createWorkspaceSlice: StateCreator<IWorkspaceSlice, [], [], IWorkspaceSlice> = (setState) => ({
  workspaceState: {
    editingState: 'unsaved',
    projectName: '',
    projectPath: '',
    systemConfigs: {
      OS: '',
      arch: '',
      shouldUseDarkMode: false,
    },
    projectData: {
      dataTypes: [],
      pous: [],
      globalVariables: [],
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  workspaceActions: {
    setEditingState: (editingState: IWorkspaceState['editingState']): void => {
      setState(
        produce((slice: IWorkspaceSlice) => {
          slice.workspaceState.editingState = editingState
        }),
      )
    },
    setUserWorkspace: (userWorkspaceState: Omit<IWorkspaceState, 'systemConfigs'>): void => {
      setState(
        produce(({ workspaceState }: IWorkspaceSlice) => {
          const { projectPath, projectName, projectData, createdAt, updatedAt } = userWorkspaceState

          workspaceState.projectPath = projectPath
          workspaceState.projectName = projectName
          workspaceState.projectData = projectData
          workspaceState.createdAt = createdAt
          workspaceState.updatedAt = updatedAt
        }),
      )
    },
    setSystemConfigs: (systemConfigsData: IWorkspaceState['systemConfigs']): void => {
      setState(
        produce(({ workspaceState }: IWorkspaceSlice) => {
          workspaceState.systemConfigs = systemConfigsData
        }),
      )
    },
    switchAppTheme: (): void => {
      setState(
        produce((slice: IWorkspaceSlice) => {
          slice.workspaceState.systemConfigs.shouldUseDarkMode = !slice.workspaceState.systemConfigs.shouldUseDarkMode
        }),
      )
    },
    updateProjectName: (projectName: string): void => {
      setState(
        produce((slice: IWorkspaceSlice) => {
          slice.workspaceState.projectName = projectName
        }),
      )
    },
    updateProjectPath: (projectPath: string): void => {
      setState(
        produce((slice: IWorkspaceSlice) => {
          slice.workspaceState.projectPath = projectPath
        }),
      )
    },
    createPou: (pouToBeCreated: IPouDTO): ICreatePouRes => {
      let response: ICreatePouRes = { ok: false, message: '' }
      setState(
        produce((slice: IWorkspaceSlice) => {
          const pouExists = slice.workspaceState.projectData.pous.find((pou) => {
            return pou.data.name === pouToBeCreated.data.name
          })
          if (!pouExists) {
            slice.workspaceState.projectData.pous.push(pouToBeCreated)
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
          const draft = slice.workspaceState.projectData.pous.find((pou) => {
            return pou.data.name === dataToBeUpdated.name
          })
          if (draft) draft.data.body = dataToBeUpdated.content
        }),
      )
    },
    deletePou: (pouToBeDeleted: string): void => {
      setState(
        produce((slice: IWorkspaceSlice) => {
          slice.workspaceState.projectData.pous = slice.workspaceState.projectData.pous.filter(
            (pou) => pou.data.name !== pouToBeDeleted,
          )
        }),
      )
    },
  },
})

export { createWorkspaceSlice, type IWorkspaceSlice }
