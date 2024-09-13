import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { WorkspaceResponse, WorkspaceSlice } from './types'
import { createTaskValidation } from './utils/tasks'
import {
  createGlobalVariableValidation,
  createVariableValidation,
  updateGlobalVariableValidation,
  updateVariableValidation,
} from './utils/variables'

const createWorkspaceSlice: StateCreator<WorkspaceSlice, [], [], WorkspaceSlice> = (setState) => ({
  workspace: {
    editingState: 'unsaved',
    projectName: '',
    projectPath: '',
    projectData: {
      dataTypes: [],
      pous: [],
      configuration: {
        resource: {
          tasks: [],
          instances: [],
          globalVariables: [],
        },
      },
    },
    systemConfigs: {
      OS: '',
      arch: '',
      shouldUseDarkMode: false,
      isWindowMaximized: false,
    },
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
          workspace.projectName = projectName
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
              variableToBeCreated.data.name = createGlobalVariableValidation(
                workspace.projectData.configuration.resource.globalVariables,
                variableToBeCreated.data.name,
              )
              if (variableToBeCreated.rowToInsert !== undefined) {
                workspace.projectData.configuration.resource.globalVariables.splice(
                  variableToBeCreated.rowToInsert,
                  0,
                  variableToBeCreated.data,
                )
                break
              }
              workspace.projectData.configuration.resource.globalVariables.push(variableToBeCreated.data)
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
              const validationResponse = updateGlobalVariableValidation(
                workspace.projectData.configuration.resource.globalVariables,
                dataToBeUpdated.data,
              )
              if (!validationResponse.ok) {
                response = validationResponse
                break
              }
              const index = dataToBeUpdated.rowId
              if (index === -1) response = { ok: false, title: 'Variable not found', message: 'Internal error' }
              workspace.projectData.configuration.resource.globalVariables[index] = {
                ...workspace.projectData.configuration.resource.globalVariables[index],
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
              workspace.projectData.configuration.resource.globalVariables.splice(variableToBeDeleted.rowId, 1)
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
              const [removed] = workspace.projectData.configuration.resource.globalVariables.splice(rowId, 1)
              workspace.projectData.configuration.resource.globalVariables.splice(newIndex, 0, removed)
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

    createTask: (taskToCreate): WorkspaceResponse => {
      const response: WorkspaceResponse = { ok: true }

      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          taskToCreate.name = createTaskValidation(
            workspace.projectData.configuration.resource.tasks,
            taskToCreate.name,
          )
          if (taskToCreate.rowToInsert !== undefined) {
            workspace.projectData.configuration.resource.tasks.splice(taskToCreate.rowToInsert, 0, taskToCreate)
          } else {
            workspace.projectData.configuration.resource.tasks.push(taskToCreate)
          }
        }),
      )

      return response
    },

    deleteTask: (taskToBeDeleted: { rowId: number }): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          const { rowId } = taskToBeDeleted

          if (rowId < 0 || rowId >= workspace.projectData.configuration.resource.tasks.length) {
            console.error('Invalid rowId')
            return
          }

          workspace.projectData.configuration.resource.tasks.splice(rowId, 1)
        }),
      )
    },

    updateTask: (dataToBeUpdated: {
      name: string
      triggering: 'Cyclic' | 'Interrupt'
      interval: string
      priority: number
      rowId: number
      id?: string
    }): WorkspaceResponse => {
      const response: WorkspaceResponse = { ok: true }
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          const { rowId } = dataToBeUpdated

          if (rowId < 0 || rowId >= workspace.projectData.configuration.resource.tasks.length) {
            console.error('Invalid rowId')
            response.ok = false
            response.title = 'Invalid Task.'
            response.message = 'The task rowId is out of range.'
            return
          }

        
          workspace.projectData.configuration.resource.tasks[rowId] = {
            ...workspace.projectData.configuration.resource.tasks[rowId],
            ...dataToBeUpdated,
          }

          console.log('Task updated:', workspace.projectData.configuration.resource.tasks[rowId])
        }),
      )

      return response
    },

    rearrangeTasks: (taskToBeRearranged): void => {
      setState(
        produce(({ workspace }: WorkspaceSlice) => {
          const { rowId, newIndex } = taskToBeRearranged

          if (rowId < 0 || newIndex < 0 || rowId >= workspace.projectData.configuration.resource.tasks.length) {
            console.error('Invalid rowId or newIndex')
            return
          }

          const [removed] = workspace.projectData.configuration.resource.tasks.splice(rowId, 1)
          workspace.projectData.configuration.resource.tasks.splice(newIndex, 0, removed)
        }),
      )
    },
  },
})

export { createWorkspaceSlice }
