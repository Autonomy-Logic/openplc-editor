import { toast } from '@root/renderer/components/_features/[app]/toast/use-toast'
import { PLCArrayDatatype } from '@root/types/PLC/open-plc'
import { produce } from 'immer'
import { v4 as uuidv4 } from 'uuid'
import { StateCreator } from 'zustand'

import { ProjectResponse, ProjectSlice } from './types'
import { createInstanceValidation, updateInstancevalidation } from './utils/instances'
import { createTaskValidation, updateTaskValidation } from './utils/tasks'
import {
  createGlobalVariableValidation,
  createVariableValidation,
  updateGlobalVariableValidation,
  updateVariableValidation,
} from './utils/variables'

const createProjectSlice: StateCreator<ProjectSlice, [], [], ProjectSlice> = (setState) => ({
  project: {
    meta: {
      name: '',
      type: 'plc-project',
      path: '',
    },
    data: {
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
  },

  projectActions: {
    /**
     * Update/Set Project state
     */
    setProject: (projectState): void => {
      setState(
        produce(({ project }: ProjectSlice) => {
          project.meta = projectState.meta
          project.data = projectState.data
        }),
      )
    },

    /**
     * Meta Actions
     */
    updateMetaName: (name: string): void => {
      setState(
        produce(({ project }: ProjectSlice) => {
          project.meta.name = name
        }),
      )
    },
    updateMetaPath: (path: string): void => {
      setState(
        produce(({ project }: ProjectSlice) => {
          project.meta.path = path
        }),
      )
    },

    /**
     * POU Actions
     */
    createPou: (pouToBeCreated): ProjectResponse => {
      let response: ProjectResponse = { ok: false, message: 'Internal error' }
      setState(
        produce(({ project }: ProjectSlice) => {
          const pouExists = project.data.pous.find((pou) => {
            return pou.data.name === pouToBeCreated.data.name
          })
          const dataTypeExists = project.data.dataTypes.find((datatype) => {
            return datatype.name === pouToBeCreated.data.name
          })

          if (!pouExists && !dataTypeExists) {
            project.data.pous.push(pouToBeCreated)
            response = { ok: true, message: 'Pou created successfully' }
            console.log('pou created:', pouToBeCreated)
          }
          if (dataTypeExists || pouExists) {
            toast({
              title: 'Invalid Pou',
              description: `You can't create a Pou with this name.`,
              variant: 'fail',
            })
          }
        }),
      )
      return response
    },
    updatePou: (dataToBeUpdated): void => {
      setState(
        produce(({ project }: ProjectSlice) => {
          const draft = project.data.pous.find((pou) => {
            return pou.data.name === dataToBeUpdated.name
          })
          if (draft) draft.data.body = dataToBeUpdated.content
        }),
      )
    },
    deletePou: (pouToBeDeleted): void => {
      setState(
        produce(({ project }: ProjectSlice) => {
          project.data.pous = project.data.pous.filter((pou) => pou.data.name !== pouToBeDeleted)
        }),
      )
    },

    /**
     * Variables Table Actions
     */
    createVariable: (variableToBeCreated): ProjectResponse => {
      let response: ProjectResponse = { ok: true }
      setState(
        produce(({ project }: ProjectSlice) => {
          const { scope } = variableToBeCreated
          switch (scope) {
            case 'global': {
              variableToBeCreated.data.name = createGlobalVariableValidation(
                project.data.configuration.resource.globalVariables,
                variableToBeCreated.data.name,
              )
              if (variableToBeCreated.rowToInsert !== undefined) {
                project.data.configuration.resource.globalVariables.splice(
                  variableToBeCreated.rowToInsert,
                  0,
                  variableToBeCreated.data,
                )
                break
              }
              project.data.configuration.resource.globalVariables.push(variableToBeCreated.data)
              response.data = variableToBeCreated.data
              break
            }
            case 'local': {
              const pou = variableToBeCreated.associatedPou
                ? project.data.pous.find((pou) => pou.data.name === variableToBeCreated.associatedPou)
                : undefined
              if (!pou) {
                console.error(`Pou ${variableToBeCreated.associatedPou} not found`)
                response = { ok: false, title: 'Pou not found' }
                break
              }
              variableToBeCreated.data = {
                ...variableToBeCreated.data,
                ...createVariableValidation(pou.data.variables, variableToBeCreated.data),
                id: variableToBeCreated.data.id ? variableToBeCreated.data.id : uuidv4(),
              }
              if (variableToBeCreated.rowToInsert !== undefined) {
                pou.data.variables.splice(variableToBeCreated.rowToInsert, 0, variableToBeCreated.data)
                break
              }
              pou.data.variables.push(variableToBeCreated.data)
              response.data = variableToBeCreated.data
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
    updateVariable: (dataToBeUpdated): ProjectResponse => {
      let response: ProjectResponse = { ok: true }
      setState(
        produce(({ project }: ProjectSlice) => {
          const { scope } = dataToBeUpdated
          switch (scope) {
            case 'global': {
              const validationResponse = updateGlobalVariableValidation(
                project.data.configuration.resource.globalVariables,
                dataToBeUpdated.data,
              )
              if (!validationResponse.ok) {
                response = validationResponse
                break
              }
              const index = dataToBeUpdated.rowId
              if (index === -1) response = { ok: false, title: 'Variable not found', message: 'Internal error' }
              project.data.configuration.resource.globalVariables[index] = {
                ...project.data.configuration.resource.globalVariables[index],
                ...dataToBeUpdated.data,
              }
              response.data = project.data.configuration.resource.globalVariables[index]
              break
            }

            case 'local': {
              const pou = dataToBeUpdated.associatedPou
                ? project.data.pous.find((pou) => pou.data.name === dataToBeUpdated.associatedPou)
                : undefined
              if (!pou) {
                console.error(`Pou ${dataToBeUpdated.associatedPou} not found`)
                response = { ok: false, title: 'Pou not found' }
                break
              }

              const index = dataToBeUpdated.rowId
              if (index === -1) response = { ok: false, title: 'Variable not found', message: 'Internal error' }

              const variableToUpdate = pou.data.variables[index]
              const validationResponse = updateVariableValidation(
                pou.data.variables,
                dataToBeUpdated.data,
                variableToUpdate,
              )
              if (!validationResponse.ok) {
                response = validationResponse
                break
              }
              pou.data.variables[index] = {
                ...pou.data.variables[index],
                ...dataToBeUpdated.data,
                ...(validationResponse.data ? validationResponse.data : {}),
              }
              response.data = pou.data.variables[index]
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
        produce(({ project }: ProjectSlice) => {
          const { scope } = variableToBeDeleted
          switch (scope) {
            case 'global': {
              if (variableToBeDeleted.rowId === -1) {
                console.error('Variable not found')
                break
              }
              project.data.configuration.resource.globalVariables.splice(variableToBeDeleted.rowId, 1)
              break
            }
            case 'local': {
              const pou = variableToBeDeleted.associatedPou
                ? project.data.pous.find((pou) => pou.data.name === variableToBeDeleted.associatedPou)
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

    rearrangeStructureVariables: (variableToBeRearranged): void => {
      setState(
        produce(({ project }: ProjectSlice) => {
          const dataType = project.data.dataTypes.find(
            (datatype) => datatype.name === variableToBeRearranged.associatedDataType,
          )

          if (!dataType || dataType.derivation !== 'structure' || !dataType.variable) {
            console.error(`Data type ${variableToBeRearranged.associatedDataType} not found or invalid`)
            return
          }

          const { rowId, newIndex } = variableToBeRearranged

          if (rowId < 0 || rowId >= dataType.variable.length) {
            console.error('Invalid rowId for rearrangement')
            return
          }

          const [removed] = dataType.variable.splice(rowId, 1)

          if (newIndex < 0 || newIndex > dataType.variable.length) {
            console.error('Invalid newIndex for rearrangement')
            return
          }

          dataType.variable.splice(newIndex, 0, removed)

          console.log('Variables rearranged:', dataType.variable)
        }),
      )
    },

    rearrangeVariables: (variableToBeRearranged): void => {
      setState(
        produce(({ project }: ProjectSlice) => {
          const { scope } = variableToBeRearranged
          switch (scope) {
            case 'global': {
              const { rowId, newIndex } = variableToBeRearranged
              const [removed] = project.data.configuration.resource.globalVariables.splice(rowId, 1)
              project.data.configuration.resource.globalVariables.splice(newIndex, 0, removed)
              break
            }
            case 'local': {
              const pou = project.data.pous.find((pou) => pou.data.name === variableToBeRearranged.associatedPou)
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

    /**
     * Data Type Actions
     */
    createDatatype: (dataToCreate) => {
      setState(
        produce(({ project }: ProjectSlice) => {
          const { data } = dataToCreate
          const { name } = data
          const dataExists = project.data.dataTypes.find((datatype) => datatype.name === name)
          const pouExists = project.data.pous.find((datatype) => datatype.data.name === name)
          if (!dataExists && !pouExists) {
            project.data.dataTypes.push(data)
          } else {
            toast({
              title: 'Invalid array',
              description: `You can't create a Pou and Data type with the same name.`,
              variant: 'fail',
            })
          }
        }),
      )
    },
    // TODO: Review requirements.
    /**
     * Function to update a unique data type.
     * @param name - Data type name to be updated.
     * @param dataToUpdate - Object contain data to update a data type.
     */
    updateDatatype: (name, dataToUpdate) => {
      setState(
        produce(({ project }: ProjectSlice) => {
          const datatypeToUpdateIndex = project.data.dataTypes.findIndex((datatype) => datatype.name === name)
          if (datatypeToUpdateIndex === -1) return
          console.log('Updating datatype', name, dataToUpdate)
          Object.assign(project.data.dataTypes[datatypeToUpdateIndex], dataToUpdate)
        }),
      )
    },
    createArrayDimension: (dataToCreateDimension) => {
      setState(
        produce(({ project }: ProjectSlice) => {
          const { name, derivation } = dataToCreateDimension
          const dataExists = project.data.dataTypes.find((datatype) => datatype.name === name) as PLCArrayDatatype
          if (!dataExists) return
          if (dataExists && derivation === 'array') {
            dataExists.dimensions.push({ dimension: '' })
          }
        }),
      )
    },

    /**
     * Task Actions
     */
    createTask: (taskToCreate): ProjectResponse => {
      const response: ProjectResponse = { ok: true }
      setState(
        produce(({ project }: ProjectSlice) => {
          const { data, rowToInsert } = taskToCreate

          data.name = createTaskValidation(project.data.configuration.resource.tasks, data.name)

          if (rowToInsert !== undefined) {
            if (rowToInsert >= 0 && rowToInsert <= project.data.configuration.resource.tasks.length) {
              project.data.configuration.resource.tasks.splice(rowToInsert, 0, data)
            } else {
              console.error('Invalid row index:', rowToInsert)
              response.ok = false
            }
          } else {
            project.data.configuration.resource.tasks.push(data)
          }
        }),
      )

      return response
    },
    deleteTask: (taskToBeDeleted: { rowId: number }): void => {
      setState(
        produce(({ project }: ProjectSlice) => {
          const { rowId } = taskToBeDeleted

          if (rowId < 0 || rowId >= project.data.configuration.resource.tasks.length) {
            console.error('Invalid rowId')
            return
          }

          project.data.configuration.resource.tasks.splice(rowId, 1)
        }),
      )
    },
    updateTask: (dataToBeUpdated): ProjectResponse => {
      let response: ProjectResponse = { ok: true }
      setState(
        produce(({ project }: ProjectSlice) => {
          const { rowId } = dataToBeUpdated
          switch (rowId) {
            case rowId: {
              const validationResponse = updateTaskValidation(
                project.data.configuration.resource.tasks,
                dataToBeUpdated.data,
              )
              if (!validationResponse.ok) {
                response = validationResponse
                break
              }
              const index = dataToBeUpdated.rowId
              if (index === -1) response = { ok: false, title: 'Task not found', message: 'Internal error' }

              project.data.configuration.resource.tasks[index] = {
                ...project.data.configuration.resource.tasks[index],
                ...dataToBeUpdated.data,
              }

              break
            }
            default: {
              console.error(` ${rowId ? rowId : ''} not found or invalid params`)
              response = { ok: false, title: 'Task not found', message: 'Task not found or invalid params' }
              break
            }
          }
        }),
      )

      return response
    },
    rearrangeTasks: (taskToBeRearranged): void => {
      setState(
        produce(({ project }: ProjectSlice) => {
          const { rowId, newIndex } = taskToBeRearranged

          if (rowId < 0 || newIndex < 0 || rowId >= project.data.configuration.resource.tasks.length) {
            console.error('Invalid rowId or newIndex')
            return
          }

          const [removed] = project.data.configuration.resource.tasks.splice(rowId, 1)
          project.data.configuration.resource.tasks.splice(newIndex, 0, removed)
        }),
      )
    },

    /**
     * Instance Actions
     */
    createInstance: (instanceToCreate): ProjectResponse => {
      const response: ProjectResponse = { ok: true }
      setState(
        produce(({ project }: ProjectSlice) => {
          const { data, rowToInsert } = instanceToCreate

          data.name = createInstanceValidation(project.data.configuration.resource.instances, data.name)

          if (rowToInsert !== undefined) {
            if (rowToInsert >= 0 && rowToInsert <= project.data.configuration.resource.instances.length) {
              project.data.configuration.resource.instances.splice(rowToInsert, 0, data)
            } else {
              console.error('Invalid row index:', rowToInsert)
              response.ok = false
            }
          } else {
            project.data.configuration.resource.instances.push(data)
          }
        }),
      )

      return response
    },
    deleteInstance: (instanceToBeDeleted: { rowId: number }): void => {
      setState(
        produce(({ project }: ProjectSlice) => {
          const { rowId } = instanceToBeDeleted

          if (rowId < 0 || rowId >= project.data.configuration.resource.instances.length) {
            console.error('Invalid rowId')
            return
          }

          project.data.configuration.resource.instances.splice(rowId, 1)
        }),
      )
    },
    updateInstance: (dataToBeUpdated): ProjectResponse => {
      let response: ProjectResponse = { ok: true }
      setState(
        produce(({ project }: ProjectSlice) => {
          const { rowId } = dataToBeUpdated
          switch (rowId) {
            case rowId: {
              const validationResponse = updateInstancevalidation(
                project.data.configuration.resource.instances,
                dataToBeUpdated.data,
              )
              if (!validationResponse.ok) {
                response = validationResponse
                break
              }
              const index = dataToBeUpdated.rowId
              if (index === -1) response = { ok: false, title: 'Instance not found', message: 'Internal error' }

              project.data.configuration.resource.instances[index] = {
                ...project.data.configuration.resource.instances[index],
                ...dataToBeUpdated.data,
              }

              break
            }
            default: {
              console.error(` ${rowId ? rowId : ''} not found or invalid params`)
              response = { ok: false, title: 'Instance not found', message: 'Instance not found or invalid params' }
              break
            }
          }
        }),
      )

      return response
    },
    rearrangeInstances: (instanceToBeRearranged): void => {
      setState(
        produce(({ project }: ProjectSlice) => {
          const { rowId, newIndex } = instanceToBeRearranged

          if (rowId < 0 || newIndex < 0 || rowId >= project.data.configuration.resource.instances.length) {
            console.error('Invalid rowId or newIndex')
            return
          }

          const [removed] = project.data.configuration.resource.instances.splice(rowId, 1)
          project.data.configuration.resource.instances.splice(newIndex, 0, removed)
        }),
      )
    },
  },
})

export { createProjectSlice }
