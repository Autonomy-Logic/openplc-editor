import type { PLCDataType, PLCVariable } from '@root/types/PLC/test'
import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { CreatePouRes, PouDTO, VariableDTO, WorkspaceSlice, WorkspaceState } from './types'

const createWorkspaceSlice: StateCreator<WorkspaceSlice, [], [], WorkspaceSlice> = (setState) => ({
  editingState: 'unsaved',
  projectName: '',
  projectPath: '',
  projectData: {
    dataTypes: [],
    pous: [
      {
        type: 'program',
        data: {
          name: 'TestProgram',
          body: '',
          language: 'st',
          variables: [
            {
              name: 'variable',
              type: {
                value: 'bool',
                definition: 'base-type',
              },
              documentation: '',
              class: 'local',
              location: '1..2',
              debug: false,
            },
            {
              name: 'variable',
              type: {
                value: 'bool',
                definition: 'base-type',
              },
              documentation: '',
              class: 'output',
              location: '1..2',
              debug: false,
            },
            {
              name: 'variable',
              type: {
                value: 'bool',
                definition: 'base-type',
              },
              documentation: '',
              class: 'input',
              location: '1..2',
              debug: false,
            },
            {
              name: 'variable',
              type: {
                value: 'bool',
                definition: 'base-type',
              },
              documentation: '',
              class: 'output',
              location: '1..2',
              debug: false,
            },
          ],
          documentation: '',
        },
      },
    ],
    globalVariables: [],
  },
  systemConfigs: {
    OS: '',
    arch: '',
    shouldUseDarkMode: false,
  },

  workspaceActions: {
    setEditingState: (editingState: WorkspaceState['editingState']): void => {
      setState(
        produce((slice: WorkspaceSlice) => {
          slice.editingState = editingState
        }),
      )
    },
    setUserWorkspace: (userWorkspaceState: Omit<WorkspaceState, 'systemConfigs'>): void => {
      setState(
        produce((slice: WorkspaceSlice) => {
          const { projectPath, projectName, projectData } = userWorkspaceState
          slice.projectPath = projectPath
          slice.projectName = projectName
          slice.projectData = projectData
        }),
      )
    },
    setSystemConfigs: (systemConfigsData: WorkspaceState['systemConfigs']): void => {
      setState(
        produce((slice: WorkspaceSlice) => {
          slice.systemConfigs = systemConfigsData
        }),
      )
    },
    switchAppTheme: (): void => {
      setState(
        produce((slice: WorkspaceSlice) => {
          slice.systemConfigs.shouldUseDarkMode = !slice.systemConfigs.shouldUseDarkMode
        }),
      )
    },
    updateProjectName: (projectName: string): void => {
      setState(
        produce((slice: WorkspaceSlice) => {
          slice.projectName = projectName
        }),
      )
    },
    updateProjectPath: (projectPath: string): void => {
      setState(
        produce((slice: WorkspaceSlice) => {
          slice.projectPath = projectPath
        }),
      )
    },
    createPou: (pouToBeCreated: PouDTO): CreatePouRes => {
      let response: CreatePouRes = { ok: false, message: 'Internal error' }
      setState(
        produce((slice: WorkspaceSlice) => {
          const pouExists = slice.projectData.pous.find((pou) => {
            return pou.data.name === pouToBeCreated.data.name
          })
          if (!pouExists) {
            slice.projectData.pous.push(pouToBeCreated)
            response = { ok: true, message: 'Pou created successfully' }
            console.log('pou created:', pouToBeCreated)
          } else {
            response = { ok: false, message: 'Pou already exists' }
          }
        }),
      )
      return response
    },
    updatePou: (dataToBeUpdated: { name: string; content: string }): void => {
      setState(
        produce((slice: WorkspaceSlice) => {
          const draft = slice.projectData.pous.find((pou) => {
            return pou.data.name === dataToBeUpdated.name
          })
          if (draft) draft.data.body = dataToBeUpdated.content
        }),
      )
    },
    deletePou: (pouToBeDeleted: string): void => {
      setState(
        produce((slice: WorkspaceSlice) => {
          slice.projectData.pous = slice.projectData.pous.filter((pou) => pou.data.name !== pouToBeDeleted)
        }),
      )
    },
    createVariable: (variableToBeCreated: VariableDTO): void => {
      setState(
        produce((slice: WorkspaceSlice) => {
          const { scope } = variableToBeCreated
          if (scope === 'global') {
            slice.projectData.globalVariables.push(variableToBeCreated.data)
          } else if (scope === 'local' && variableToBeCreated.associatedPou) {
            const pou = slice.projectData.pous.find((pou) => pou.data.name === variableToBeCreated.associatedPou)
            if (pou) {
              pou.data.variables.push(variableToBeCreated.data)
            } else {
              console.error(`Pou ${variableToBeCreated.associatedPou} not found`)
            }
            console.log('pou:', pou)
          } else {
            console.error(`Scope ${scope} not found or invalid params`)
          }
        }),
      )
    },
    /**
     * This must be validated (global scope)
     **/
    updateVariable: (
      dataToBeUpdated: Omit<VariableDTO, 'data'> & { rowId: number; data: Partial<PLCVariable> },
    ): void => {
      setState(
        produce((slice: WorkspaceSlice) => {
          const checkIfNameExists = (variables: PLCVariable[], name: string | undefined) => {
            return name !== undefined ? variables.some((variable) => variable.name === name) : false
          }

          const { scope } = dataToBeUpdated
          if (scope === 'global') {
            if (!checkIfNameExists(slice.projectData.globalVariables, dataToBeUpdated.data.name)) {
              const index = dataToBeUpdated.rowId
              if (index !== -1) {
                slice.projectData.globalVariables[index] = {
                  ...slice.projectData.globalVariables[index],
                  ...dataToBeUpdated.data,
                }
              }
            } else {
              console.error(`Variable ${dataToBeUpdated.data.name} already exists`)
            }
          } else if (scope === 'local' && dataToBeUpdated.associatedPou) {
            const pou = slice.projectData.pous.find((pou) => pou.data.name === dataToBeUpdated.associatedPou)
            if (pou) {
              if (!checkIfNameExists(pou.data.variables, dataToBeUpdated.data.name)) {
                const index = dataToBeUpdated.rowId
                if (index !== -1) {
                  pou.data.variables[index] = { ...pou.data.variables[index], ...dataToBeUpdated.data }
                }
              } else {
                console.error(`Variable ${dataToBeUpdated.data.name} already exists`)
              }
            } else {
              console.error(`Pou ${dataToBeUpdated.associatedPou} not found`)
            }
          } else {
            console.error(`Scope ${scope} not found or invalid params`)
          }
        }),
      )
    },
    deleteVariable: (variableToBeDeleted: Omit<VariableDTO, 'data'> & { rowId: number }): void => {
      setState(
        produce((slice: WorkspaceSlice) => {
          const { scope } = variableToBeDeleted
          if (scope === 'global') {
            slice.projectData.globalVariables.splice(variableToBeDeleted.rowId, 1)
          } else if (scope === 'local' && variableToBeDeleted.associatedPou) {
            const pou = slice.projectData.pous.find((pou) => pou.data.name === variableToBeDeleted.associatedPou)
            if (pou) {
              const index = variableToBeDeleted.rowId
              if (index !== -1) {
                pou.data.variables.splice(index, 1)
              }
            } else {
              console.error(`Pou ${variableToBeDeleted.associatedPou} not found`)
            }
          } else {
            console.error(`Scope ${scope} not found or invalid params`)
          }
        }),
      )
    },
    rearrangeVariables: (
      variableToBeRearranged: Omit<VariableDTO, 'data'> & { rowId: number; newIndex: number },
    ): void => {
      setState(
        produce((slice: WorkspaceSlice) => {
          const { scope } = variableToBeRearranged
          if (scope === 'global') {
            const { rowId, newIndex } = variableToBeRearranged
            const [removed] = slice.projectData.globalVariables.splice(rowId, 1)
            slice.projectData.globalVariables.splice(newIndex, 0, removed)
          } else if (scope === 'local' && variableToBeRearranged.associatedPou) {
            const pou = slice.projectData.pous.find((pou) => pou.data.name === variableToBeRearranged.associatedPou)
            if (pou) {
              const { rowId, newIndex } = variableToBeRearranged
              const [removed] = pou.data.variables.splice(rowId, 1)
              pou.data.variables.splice(newIndex, 0, removed)
            } else {
              console.error(`Pou ${variableToBeRearranged.associatedPou} not found`)
            }
          } else {
            console.error(`Scope ${scope} not found or invalid params`)
          }
        }),
      )
    },
    createDatatype: (dataToCreate: PLCDataType) => {
      setState(
        produce((slice: WorkspaceSlice) => {
          const { name } = dataToCreate
          const dataExists = slice.projectData.dataTypes.find((datatype) => datatype.name === name)
          if (!dataExists) {
            slice.projectData.dataTypes.push(dataToCreate)
          } else {
            console.error(`Datatype ${name} already exists`)
          }
        }),
      )
    },
  },
})

export { createWorkspaceSlice }
