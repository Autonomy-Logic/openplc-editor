import type { PLCFunction, PLCFunctionBlock, PLCProgram, PLCProjectData, PLCVariable } from '@root/types/PLC/open-plc'
import { PLCDataType } from '@root/types/PLC/open-plc'

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

type WorkspaceResponse = {
  ok: boolean
  title?: string
  message?: string
}

type WorkspaceActions = {
  setEditingState: (editingState: WorkspaceState['editingState']) => void
  setUserWorkspace: (userWorkspaceState: Omit<WorkspaceState, 'systemConfigs'>) => void
  setSystemConfigs: (systemConfigs: WorkspaceState['systemConfigs']) => void
  switchAppTheme: () => void
  updateProjectName: (projectName: string) => void
  updateProjectPath: (projectPath: string) => void
  createPou: (pouToBeCreated: PouDTO) => WorkspaceResponse
  updatePou: (dataToBeUpdated: { name: string; content: string }) => void
  deletePou: (pouToBeDeleted: string) => void
  createVariable: (variableToBeCreated: VariableDTO & { rowToInsert?: number }) => WorkspaceResponse
  updateVariable: (
    dataToBeUpdated: Omit<VariableDTO, 'data'> & { rowId: number; data: Partial<PLCVariable> },
  ) => WorkspaceResponse
  deleteVariable: (variableToBeDeleted: Omit<VariableDTO, 'data'> & { rowId: number }) => void
  rearrangeVariables: (variableToBeRearranged: Omit<VariableDTO, 'data'> & { rowId: number; newIndex: number }) => void
  createDatatype: (dataToCreate: PLCDataType) => void
}

type WorkspaceSlice = WorkspaceState & {
  workspaceActions: WorkspaceActions
}

export {
  PouDTO,
  VariableDTO,
  WorkspaceActions,
  WorkspaceResponse,
  WorkspaceSlice,
  WorkspaceState,
  // type IDatatypeDTO = {
  //   id: number
  //   name: string
  //   derivation: 'enum' | 'struct' | 'array'
  // }
}
