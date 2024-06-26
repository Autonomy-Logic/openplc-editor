import type { PLCDataType, PLCVariable } from '@root/types/PLC/test'
import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { PouDTO, VariableDTO, WorkspaceResponse, WorkspaceSlice, WorkspaceState } from './types'

/**
 * This is a validation to check if the variable name already exists.
 **/
const checkIfVariableExists = (variables: PLCVariable[], name: string) => {
  return variables.some((variable) => variable.name === name)
}
/**
 * This is a validation to check if the variable name is correct.
 **/
const variableNameValidation = (variableName: string | undefined) => {
  const regex = /^[a-zA-Z]+([A-Z][a-z]+|_[a-zA-Z0-9]+)*_?[0-9]*$/
  return variableName === undefined || variableName === '' ? false : regex.test(variableName)
}

/**
 * This is a validation to check if it is needed changing the name of a variable at creation.
 * If the variable existis change the variable name.
 **/
const createVariableValidation = (variables: PLCVariable[], variableName: string) => {
  if (checkIfVariableExists(variables, variableName)) {
    const regex = /_\d+$/
    const filteredVariables = variables.filter((variable: PLCVariable) =>
      variable.name.includes(variableName.replace(regex, '')),
    )
    const sortedVariables = filteredVariables.sort((a, b) => {
      const matchA = a.name.match(regex)
      const matchB = b.name.match(regex)
      if (matchA && matchB) {
        return parseInt(matchA[0].slice(1)) - parseInt(matchB[0].slice(1))
      }
      return 0
    })
    const biggestVariable = sortedVariables[sortedVariables.length - 1].name.match(regex)
    let number = biggestVariable ? parseInt(biggestVariable[0].slice(1)) : 0
    for (let i = sortedVariables.length - 1; i >= 1; i--) {
      const previousVariable = sortedVariables[i].name.match(regex)
      const previousNumber = previousVariable ? parseInt(previousVariable[0].slice(1)) : 0
      const currentVariable = sortedVariables[i - 1].name.match(regex)
      const currentNumber = currentVariable ? parseInt(currentVariable[0].slice(1)) : 0
      if (currentNumber !== previousNumber - 1) {
        number = currentNumber
      }
    }
    const newVariableName = `${variableName.replace(regex, '')}_${number + 1}`
    return newVariableName
  }
  return variableName
}

/**
 * This is a validation to check the name of the variable at update.
 * If the variable name is invalid, create a response.
 * If the variable name already exists, create or change a response.
 **/
const updateVariableValidation = (variables: PLCVariable[], name: string | undefined) => {
  let response: WorkspaceResponse = { ok: true }
  if (!variableNameValidation(name)) {
    console.error(`Variable "${name}" name is invalid`)
    response = {
      ok: false,
      title: 'Variable name is invalid.',
      message: `Please make sure that the name is valid. Valid names: CamelCase, PascalCase or SnakeCase.`,
    }
  }
  if (checkIfVariableExists(variables, name as string)) {
    console.error(`Variable "${name}" already exists`)
    response = {
      ok: false,
      title: response.title ? `${response.title.replace('.', ' ')} and already exists.` : 'Variable already exists',
      message: response.message
        ? `${response.message.split('.')[0]} and the name is unique. ${response.message.split('.')[1]}`
        : 'Please make sure that the name is unique.',
    }
  }
  return response
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
          switch (scope) {
            case 'global': {
              variableToBeCreated.data.name = createVariableValidation(
                slice.projectData.globalVariables,
                variableToBeCreated.data.name,
              )
              if (variableToBeCreated.rowToInsert !== undefined) {
                slice.projectData.globalVariables.splice(variableToBeCreated.rowToInsert, 0, variableToBeCreated.data)
                break
              }
              slice.projectData.globalVariables.push(variableToBeCreated.data)
              break
            }
            case 'local': {
              const pou = variableToBeCreated.associatedPou
                ? slice.projectData.pous.find((pou) => pou.data.name === variableToBeCreated.associatedPou)
                : undefined
              if (!pou) {
                console.error(`Pou ${variableToBeCreated.associatedPou} not found`)
                response = { ok: false, title: 'Pou not found' }
                break
              }
              variableToBeCreated.data.name = createVariableValidation(
                pou.data.variables,
                variableToBeCreated.data.name,
              )
              if (variableToBeCreated.rowToInsert !== undefined) {
                pou.data.variables.splice(variableToBeCreated.rowToInsert, 0, variableToBeCreated.data)
                break
              }
              pou.data.variables.push(variableToBeCreated.data)
              break
            }
            default: {
              console.error(`Scope ${scope ? scope : ''} not found or invalid params`)
              response = {
                ok: false,
                title: 'Scope not found',
                message: 'Check if the scope or the parameters is correct',
              }
              break
            }
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
          switch (scope) {
            case 'global': {
              const validation = updateVariableValidation(slice.projectData.globalVariables, dataToBeUpdated.data.name)
              if (!validation.ok) {
                response = validation
                break
              }
              const index = dataToBeUpdated.rowId
              if (index === -1) response = { ok: false, title: 'Variable not found', message: 'Internal error' }
              slice.projectData.globalVariables[index] = {
                ...slice.projectData.globalVariables[index],
                ...dataToBeUpdated.data,
              }
              break
            }
            case 'local': {
              const pou = dataToBeUpdated.associatedPou
                ? slice.projectData.pous.find((pou) => pou.data.name === dataToBeUpdated.associatedPou)
                : undefined
              if (!pou) {
                console.error(`Pou ${dataToBeUpdated.associatedPou} not found`)
                response = { ok: false, title: 'Pou not found' }
                break
              }
              const validation = updateVariableValidation(pou.data.variables, dataToBeUpdated.data.name)
              if (!validation.ok) {
                response = validation
                break
              }
              const index = dataToBeUpdated.rowId
              if (index === -1) response = { ok: false, title: 'Variable not found', message: 'Internal error' }
              pou.data.variables[index] = { ...pou.data.variables[index], ...dataToBeUpdated.data }
              break
            }
            default: {
              console.error(`Scope ${scope ? scope : ''} not found or invalid params`)
              response = { ok: false, title: 'Scope not found', message: 'Scope not found or invalid params' }
              break
            }
          }
        }),
      )
      return response
    },
    deleteVariable: (variableToBeDeleted: Omit<VariableDTO, 'data'> & { rowId: number }): void => {
      setState(
        produce((slice: WorkspaceSlice) => {
          const { scope } = variableToBeDeleted
          switch (scope) {
            case 'global': {
              if (variableToBeDeleted.rowId === -1) {
                console.error('Variable not found')
                break
              }
              slice.projectData.globalVariables.splice(variableToBeDeleted.rowId, 1)
              break
            }
            case 'local': {
              const pou = variableToBeDeleted.associatedPou
                ? slice.projectData.pous.find((pou) => pou.data.name === variableToBeDeleted.associatedPou)
                : undefined
              if (!pou) {
                console.error(`Pou ${variableToBeDeleted.associatedPou} not found`)
                return
              }
              if (variableToBeDeleted.rowId === -1) {
                console.error('Variable not found')
                break
              }
              pou.data.variables.splice(variableToBeDeleted.rowId, 1)
              break
            }
            default: {
              console.error(`Scope ${scope ? scope : ''} not found or invalid params`)
              break
            }
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
          switch (scope) {
            case 'global': {
              const { rowId, newIndex } = variableToBeRearranged
              const [removed] = slice.projectData.globalVariables.splice(rowId, 1)
              slice.projectData.globalVariables.splice(newIndex, 0, removed)
              break
            }
            case 'local': {
              const pou = slice.projectData.pous.find((pou) => pou.data.name === variableToBeRearranged.associatedPou)
              if (!pou) {
                console.error(`Pou ${variableToBeRearranged.associatedPou} not found`)
                return
              }
              const { rowId, newIndex } = variableToBeRearranged
              const [removed] = pou.data.variables.splice(rowId, 1)
              pou.data.variables.splice(newIndex, 0, removed)
              break
            }
            default: {
              console.error(`Scope ${scope ? scope : ''} not found or invalid params`)
              break
            }
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
