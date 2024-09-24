import { PLCArrayDatatype } from '@root/types/PLC/open-plc'
import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { WorkspaceResponse, WorkspaceSlice } from './types'
import { createVariableValidation, updateVariableValidation } from './utils/variables'

const createWorkspaceSlice: StateCreator<WorkspaceSlice, [], [], WorkspaceSlice> = (setState) => ({
  workspace: {
    editingState: 'unsaved',
    projectPath: '',
    projectData: {
      dataTypes: [],
      pous: [],
      globalVariables: [],
      projectName: '',
    },
    systemConfigs: {
      OS: '',
      arch: '',
      shouldUseDarkMode: false,
      isWindowMaximized: false,
    },
    projectName: '',
  },

  workspaceActions: {
    setEditingState: (editingState): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.editingState = editingState
        }),
      )
    },
    setUserWorkspace: ({ projectPath, projectName, projectData }): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.projectPath = projectPath
          workspace.projectName = projectName
          workspace.projectData = projectData
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

    updateProjectName: (projectName): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.projectData.projectName = projectName
        }),
      )
    },
    updateProjectPath: (projectPath): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.projectPath = projectPath
        }),
      )
    },

    createPou: (pouToBeCreated): WorkspaceResponse => {
      let response: WorkspaceResponse = { ok: false, message: 'Internal error' }
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          const pouExists = workspace.projectData.pous.find((pou) => {
            return pou.data.name === pouToBeCreated.data.name
          })
          if (!pouExists) {
            workspace.projectData.pous.push(pouToBeCreated)
            response = { ok: true, message: 'Pou created successfully' }
            console.log('pou created:', pouToBeCreated)
          } else {
            response = { ok: false, message: 'Pou already exists' }
          }
        }),
      )
      return response
    },
    updatePou: (dataToBeUpdated): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          const draft = workspace.projectData.pous.find((pou) => {
            return pou.data.name === dataToBeUpdated.name
          })
          if (draft) draft.data.body = dataToBeUpdated.content
        }),
      )
    },
    deletePou: (pouToBeDeleted): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          workspace.projectData.pous = workspace.projectData.pous.filter((pou) => pou.data.name !== pouToBeDeleted)
        }),
      )
    },

    createVariable: (variableToBeCreated): WorkspaceResponse => {
      let response: WorkspaceResponse = { ok: true }
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          const { scope } = variableToBeCreated
          switch (scope) {
            case 'global': {
              variableToBeCreated.data.name = createVariableValidation(
                workspace.projectData.globalVariables,
                variableToBeCreated.data.name,
              )
              if (variableToBeCreated.rowToInsert !== undefined) {
                workspace.projectData.globalVariables.splice(
                  variableToBeCreated.rowToInsert,
                  0,
                  variableToBeCreated.data,
                )
                break
              }
              workspace.projectData.globalVariables.push(variableToBeCreated.data)
              break
            }
            case 'local': {
              const pou = variableToBeCreated.associatedPou
                ? workspace.projectData.pous.find((pou) => pou.data.name === variableToBeCreated.associatedPou)
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
    updateVariable: (dataToBeUpdated): WorkspaceResponse => {
      let response: WorkspaceResponse = { ok: true }
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          const { scope } = dataToBeUpdated
          switch (scope) {
            case 'global': {
              const validationResponse = updateVariableValidation(
                workspace.projectData.globalVariables,
                dataToBeUpdated.data,
              )
              if (!validationResponse.ok) {
                response = validationResponse
                break
              }
              const index = dataToBeUpdated.rowId
              if (index === -1) response = { ok: false, title: 'Variable not found', message: 'Internal error' }
              workspace.projectData.globalVariables[index] = {
                ...workspace.projectData.globalVariables[index],
                ...dataToBeUpdated.data,
              }
              break
            }

            case 'local': {
              const pou = dataToBeUpdated.associatedPou
                ? workspace.projectData.pous.find((pou) => pou.data.name === dataToBeUpdated.associatedPou)
                : undefined
              if (!pou) {
                console.error(`Pou ${dataToBeUpdated.associatedPou} not found`)
                response = { ok: false, title: 'Pou not found' }
                break
              }
              const validationResponse = updateVariableValidation(pou.data.variables, dataToBeUpdated.data)
              if (!validationResponse.ok) {
                response = validationResponse
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
    deleteVariable: (variableToBeDeleted): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          const { scope } = variableToBeDeleted
          switch (scope) {
            case 'global': {
              if (variableToBeDeleted.rowId === -1) {
                console.error('Variable not found')
                break
              }
              workspace.projectData.globalVariables.splice(variableToBeDeleted.rowId, 1)
              break
            }
            case 'local': {
              const pou = variableToBeDeleted.associatedPou
                ? workspace.projectData.pous.find((pou) => pou.data.name === variableToBeDeleted.associatedPou)
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
    rearrangeVariables: (variableToBeRearranged): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          const { scope } = variableToBeRearranged
          switch (scope) {
            case 'global': {
              const { rowId, newIndex } = variableToBeRearranged
              const [removed] = workspace.projectData.globalVariables.splice(rowId, 1)
              workspace.projectData.globalVariables.splice(newIndex, 0, removed)
              break
            }
            case 'local': {
              const pou = workspace.projectData.pous.find(
                (pou) => pou.data.name === variableToBeRearranged.associatedPou,
              )
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

    createDatatype: (dataToCreate) => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          const { name } = dataToCreate
          const dataExists = workspace.projectData.dataTypes.find((datatype) => datatype.name === name)
          if (!dataExists) {
            workspace.projectData.dataTypes.push(dataToCreate)
          } else {
            console.error(`Datatype ${name} already exists`)
          }
        }),
      )
    },
    updateDatatype: ({ name, derivation, dataToUpdate}) => {
      setState(produce(({workspace}:WorkspaceSlice) => {
        const _dataTypeExists = workspace.projectData.dataTypes.find((datatype) => datatype.name === name)
        console.log(derivation, dataToUpdate)
        }))
    },
    createArrayDimension: (dataToCreateDimension) => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          const { name, derivation } = dataToCreateDimension
          const dataExists = workspace.projectData.dataTypes.find(
            (datatype) => datatype.name === name,
          ) as PLCArrayDatatype
          if (!dataExists) return
          if (dataExists && derivation === 'array') {
            dataExists.dimensions.push({ dimension: '' })
          }
        }),
      )
    },
  },
})

export { createWorkspaceSlice }
