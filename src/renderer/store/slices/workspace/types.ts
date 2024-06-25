import type { PLCFunction, PLCFunctionBlock, PLCProgram, PLCProjectData, PLCVariable } from '@root/types/PLC/test'
import { PLCDataType } from '@root/types/PLC/test'

// type IDatatypeDTO = {
//   id: number
//   name: string
//   derivation: 'enum' | 'struct' | 'array'
// }

type VariableDTO = {
  scope: 'global' | 'local'
  associatedPou?: string
  data: PLCVariable
}

type PouDTO =
  | {
      type: 'program'
      data: PLCProgram
    }
  | {
      type: 'function'
      data: PLCFunction
    }
  | {
      type: 'function-block'
      data: PLCFunctionBlock
    }

type WorkspaceState = {
  projectName: string
  projectPath: string
  projectData: PLCProjectData
  editingState: 'save-request' | 'saved' | 'unsaved'
  systemConfigs: {
    OS: 'win32' | 'linux' | 'darwin' | ''
    arch: 'x64' | 'arm' | ''
    shouldUseDarkMode: boolean
  }
}

type CreatePouRes = {
  ok: boolean
  message?: string
}

type WorkspaceActions = {
  setEditingState: (editingState: WorkspaceState['editingState']) => void
  setUserWorkspace: (userWorkspaceState: Omit<WorkspaceState, 'systemConfigs'>) => void
  setSystemConfigs: (systemConfigs: WorkspaceState['systemConfigs']) => void
  switchAppTheme: () => void
  updateProjectName: (projectName: string) => void
  updateProjectPath: (projectPath: string) => void
  createPou: (pouToBeCreated: PouDTO) => CreatePouRes
  updatePou: (dataToBeUpdated: { name: string; content: string }) => void
  deletePou: (pouToBeDeleted: string) => void
  createVariable: (variableToBeCreated: VariableDTO) => void
  updateVariable: (dataToBeUpdated: Omit<VariableDTO, 'data'> & { rowId: number; data: Partial<PLCVariable> }) => void
  deleteVariable: (variableToBeDeleted: Omit<VariableDTO, 'data'> & { rowId: number }) => void
  createDatatype: (dataToCreate: PLCDataType) => void
}

type WorkspaceSlice = WorkspaceState & {
  workspaceActions: WorkspaceActions
}

export { CreatePouRes, PouDTO, VariableDTO, WorkspaceActions, WorkspaceSlice, WorkspaceState }
