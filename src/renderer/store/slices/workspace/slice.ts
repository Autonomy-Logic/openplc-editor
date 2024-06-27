import type { PLCDataType, PLCVariable } from '@root/types/PLC/open-plc'
import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { PouDTO, VariableDTO, WorkspaceResponse, WorkspaceSlice, WorkspaceState } from './types'

const checkIfNameExists = (variables: PLCVariable[], name: string | undefined) => {
  return name !== undefined ? variables.some((variable) => variable.name === name) : false
}

const createWorkspaceSlice: StateCreator<WorkspaceSlice, [], [], WorkspaceSlice> = (setState) => ({
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

    createPou: (pouToBeCreated: PouDTO): WorkspaceResponse => {
      let response: WorkspaceResponse = { ok: false, message: 'Internal error' }
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

    createVariable: (variableToBeCreated: VariableDTO & { rowToInsert?: number }): WorkspaceResponse => {
      let response: WorkspaceResponse = { ok: true }
      setState(
        produce((slice: WorkspaceSlice) => {
          const { scope } = variableToBeCreated
          if (scope === 'global') {
            slice.projectData.globalVariables.push(variableToBeCreated.data)
          } else if (scope === 'local' && variableToBeCreated.associatedPou) {
            const pou = slice.projectData.pous.find((pou) => pou.data.name === variableToBeCreated.associatedPou)
            if (pou) {
              if (checkIfNameExists(pou.data.variables, variableToBeCreated.data.name)) {
                const regex = /-\d+$/
                const filteredVariables = pou.data.variables.filter((variable) =>
                  variable.name.includes(variableToBeCreated.data.name.replace(regex, '')),
                )
                const sortedVariables = filteredVariables.sort((a, b) => {
                  const matchA = a.name.match(regex)
                  const matchB = b.name.match(regex)
                  if (matchA && matchB) {
                    return parseInt(matchA[0].slice(1)) - parseInt(matchB[0].slice(1))
                  }
                  return 0
                })
                const biggestIndex = sortedVariables[sortedVariables.length - 1].name.match(regex)
                variableToBeCreated.data.name = `${variableToBeCreated.data.name.replace(regex, '')}-${biggestIndex ? parseInt(biggestIndex[0].slice(1)) + 1 : 1}`
              }
              if (variableToBeCreated.rowToInsert !== undefined) {
                pou.data.variables.splice(variableToBeCreated.rowToInsert, 0, variableToBeCreated.data)
              } else {
                pou.data.variables.push(variableToBeCreated.data)
              }
            } else {
              console.error(`Pou ${variableToBeCreated.associatedPou} not found`)
              response = { ok: false, title: 'Pou not found' }
            }
            console.log('pou:', pou)
          } else {
            console.error(`Scope ${scope} not found or invalid params`)
            response = { ok: false, title: 'Scope not found', message: 'Scope not found or invalid params' }
          }
        }),
      )
      return response
    },
    updateVariable: (
      dataToBeUpdated: Omit<VariableDTO, 'data'> & { rowId: number; data: Partial<PLCVariable> },
    ): WorkspaceResponse => {
      let response: WorkspaceResponse = { ok: true }
      setState(
        produce((slice: WorkspaceSlice) => {
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
              response = {
                ok: false,
                title: 'Variable already exists',
                message: 'Please make sure that the name is unique',
              }
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
                response = {
                  ok: false,
                  title: 'Variable already exists',
                  message: 'Please make sure that the name is unique',
                }
              }
            } else {
              console.error(`Pou ${dataToBeUpdated.associatedPou} not found`)
              response = { ok: false, title: 'Pou not found' }
            }
          } else {
            console.error(`Scope ${scope} not found or invalid params`)
            response = { ok: false, title: 'Scope not found', message: 'Scope not found or invalid params' }
          }
        }),
      )
      return response
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
