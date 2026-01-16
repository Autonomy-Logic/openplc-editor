import { toast } from '@root/renderer/components/_features/[app]/toast/use-toast'
import type {
  OpcUaNodeConfig,
  OpcUaSecurityProfile,
  OpcUaServerConfig,
  OpcUaTrustedCertificate,
  OpcUaUser,
} from '@root/types/PLC/open-plc'
import {
  ModbusIOPoint,
  PLCArrayDatatype,
  PLCDataType,
  PLCGlobalVariable,
  PLCInstance,
  PLCServer,
  PLCTask,
  PLCVariable,
  S7CommDataBlock,
  S7CommLogging,
  S7CommPlcIdentity,
  S7CommServerSettings,
  S7CommSystemArea,
} from '@root/types/PLC/open-plc'
import { isLegalIdentifier } from '@root/utils/keywords'
import { DEFAULT_BUFFER_MAPPING } from '@root/utils/modbus/generate-modbus-slave-config'
import { produce } from 'immer'
import { v4 as uuidv4 } from 'uuid'
import { StateCreator } from 'zustand'

import { ProjectResponse, ProjectSlice } from './types'

// Default S7Comm server configuration
const DEFAULT_S7COMM_SERVER_SETTINGS: S7CommServerSettings = {
  enabled: false,
  bindAddress: '0.0.0.0',
  port: 102,
  maxClients: 32,
  workIntervalMs: 100,
  sendTimeoutMs: 3000,
  recvTimeoutMs: 3000,
  pingTimeoutMs: 10000,
  pduSize: 480,
}

const DEFAULT_S7COMM_PLC_IDENTITY: S7CommPlcIdentity = {
  name: 'OpenPLC Runtime',
  moduleType: 'CPU 315-2 PN/DP',
  serialNumber: 'S C-OPENPLC01',
  copyright: 'OpenPLC Project',
  moduleName: 'OpenPLC',
}

const DEFAULT_S7COMM_LOGGING: S7CommLogging = {
  logConnections: true,
  logDataAccess: false,
  logErrors: true,
}

// Default OPC-UA server configuration
const DEFAULT_OPCUA_SERVER_CONFIG: OpcUaServerConfig = {
  server: {
    enabled: false,
    name: 'OpenPLC OPC UA Server',
    applicationUri: 'urn:openplc:opcua:server',
    productUri: 'urn:openplc:runtime',
    bindAddress: '0.0.0.0',
    port: 4840,
    endpointPath: '/openplc/opcua',
  },
  securityProfiles: [
    {
      id: uuidv4(),
      name: 'insecure',
      enabled: true,
      securityPolicy: 'None',
      securityMode: 'None',
      authMethods: ['Anonymous'],
    },
  ],
  security: {
    serverCertificateStrategy: 'auto_self_signed',
    serverCertificateCustom: null,
    serverPrivateKeyCustom: null,
    trustedClientCertificates: [],
  },
  users: [],
  cycleTimeMs: 100,
  addressSpace: {
    namespaceUri: 'urn:openplc:opcua:namespace',
    nodes: [],
  },
}

/**
 * Initializes protocol-specific configuration for a server.
 * Extracts protocol initialization logic to reduce complexity in createServer.
 */
const initializeServerProtocolConfig = (serverData: PLCServer): PLCServer => {
  if (serverData.protocol === 'modbus-tcp' && !serverData.modbusSlaveConfig) {
    return {
      ...serverData,
      modbusSlaveConfig: {
        enabled: false,
        networkInterface: '0.0.0.0',
        port: 502,
      },
    }
  }
  if (serverData.protocol === 's7comm' && !serverData.s7commSlaveConfig) {
    return {
      ...serverData,
      s7commSlaveConfig: {
        server: { ...DEFAULT_S7COMM_SERVER_SETTINGS },
        plcIdentity: { ...DEFAULT_S7COMM_PLC_IDENTITY },
        dataBlocks: [],
        logging: { ...DEFAULT_S7COMM_LOGGING },
      },
    }
  }
  if (serverData.protocol === 'opcua' && !serverData.opcuaServerConfig) {
    return {
      ...serverData,
      opcuaServerConfig: {
        ...DEFAULT_OPCUA_SERVER_CONFIG,
        securityProfiles: DEFAULT_OPCUA_SERVER_CONFIG.securityProfiles.map((profile) => ({
          ...profile,
          id: uuidv4(),
        })),
      },
    }
  }
  return serverData
}

const getFunctionCodeInfo = (
  functionCode: '1' | '2' | '3' | '4' | '5' | '6' | '15' | '16',
): { type: string; iecPrefix: string; isBit: boolean } => {
  switch (functionCode) {
    case '1':
      return { type: 'Digital Input (Coil Status)', iecPrefix: '%IX', isBit: true }
    case '2':
      return { type: 'Digital Input (Discrete Input)', iecPrefix: '%IX', isBit: true }
    case '3':
      return { type: 'Analog Input (Holding Register)', iecPrefix: '%IW', isBit: false }
    case '4':
      return { type: 'Analog Input (Input Register)', iecPrefix: '%IW', isBit: false }
    case '5':
      return { type: 'Digital Output (Single Coil)', iecPrefix: '%QX', isBit: true }
    case '6':
      return { type: 'Analog Output (Single Register)', iecPrefix: '%QW', isBit: false }
    case '15':
      return { type: 'Digital Output (Multiple Coils)', iecPrefix: '%QX', isBit: true }
    case '16':
      return { type: 'Analog Output (Multiple Registers)', iecPrefix: '%QW', isBit: false }
    default:
      return { type: 'Unknown', iecPrefix: '%MW', isBit: false }
  }
}

const generateIOPoints = (
  functionCode: '1' | '2' | '3' | '4' | '5' | '6' | '15' | '16',
  length: number,
  groupName: string,
  usedAddresses: Set<string>,
): ModbusIOPoint[] => {
  const { type, iecPrefix, isBit } = getFunctionCodeInfo(functionCode)
  const points: ModbusIOPoint[] = []

  let currentAddress = 0
  for (let i = 0; i < length; i++) {
    let iecLocation: string
    if (isBit) {
      while (true) {
        iecLocation = `${iecPrefix}${Math.floor(currentAddress / 8)}.${currentAddress % 8}`
        if (!usedAddresses.has(iecLocation)) break
        currentAddress++
      }
    } else {
      while (true) {
        iecLocation = `${iecPrefix}${currentAddress}`
        if (!usedAddresses.has(iecLocation)) break
        currentAddress++
      }
    }

    points.push({
      id: uuidv4(),
      name: `${groupName}_${i}`,
      type,
      iecLocation,
      alias: '',
    })

    usedAddresses.add(iecLocation)
    currentAddress++
  }

  return points
}
import { getVariableBasedOnRowIdOrVariableId } from './utils'
import { createInstanceValidation, updateInstanceValidation } from './validation/instances'
import { createTaskValidation, updateTaskValidation } from './validation/tasks'
import {
  createGlobalVariableValidation,
  createVariableValidation,
  updateGlobalVariableValidation,
  updateVariableValidation,
} from './validation/variables'

const createProjectSlice: StateCreator<ProjectSlice, [], [], ProjectSlice> = (setState, getState) => ({
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
      deletedPous: [],
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
          project.data = projectState.data as ProjectSlice['project']['data']
        }),
      )
    },
    setPous: (pous): void => {
      setState(
        produce(({ project }: ProjectSlice) => {
          project.data.pous = pous as typeof project.data.pous
        }),
      )
    },
    clearProjects: (): void => {
      setState(
        produce(({ project }: ProjectSlice) => {
          project.meta = {
            name: '',
            type: 'plc-project',
            path: '',
          }
          project.data = {
            dataTypes: [],
            pous: [],
            configuration: {
              resource: {
                tasks: [],
                instances: [],
                globalVariables: [],
              },
            },
            deletedPous: [],
          }
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
            // @ts-expect-error - pouToBeCreated can not be from a valid type once it can be a rung object.
            project.data.pous.push(pouToBeCreated)
            if (project.data.deletedPous) {
              project.data.deletedPous = project.data.deletedPous.filter(
                (deletedPou) => deletedPou.name !== pouToBeCreated.data.name,
              )
            }
            response = { ok: true, message: 'Pou created successfully' }
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
          // @ts-expect-error - pouToBeCreated can not be from a valid type once it can be a rung object.
          if (draft) draft.data.body = dataToBeUpdated.content
        }),
      )
    },
    deletePou: (pouToBeDeleted): void => {
      setState(
        produce(({ project }: ProjectSlice) => {
          const pouToDelete = project.data.pous.find((pou) => pou.data.name === pouToBeDeleted)
          if (pouToDelete) {
            if (!project.data.deletedPous) {
              project.data.deletedPous = []
            }
            project.data.deletedPous.push({
              name: pouToDelete.data.name,
              type: pouToDelete.type,
              language: pouToDelete.data.body.language,
            })
          }
          project.data.pous = project.data.pous.filter((pou) => pou.data.name !== pouToBeDeleted)
        }),
      )
    },

    updatePouReturnType: (pouName, returnType): void => {
      setState(
        produce(({ project }: ProjectSlice) => {
          const draft = project.data.pous.find((pou) => {
            return pou.data.name === pouName
          })
          if (draft && draft.type === 'function') draft.data.returnType = returnType
        }),
      )
    },
    clearPouVariablesText: (pouName: string): void => {
      setState(
        produce(({ project }: ProjectSlice) => {
          const draft = project.data.pous.find((pou) => {
            return pou.data.name === pouName
          })
          if (draft && 'variablesText' in draft.data) {
            delete (draft.data as typeof draft.data & { variablesText?: string }).variablesText
          }
        }),
      )
    },
    updatePouDocumentation: (pouName, documentation): void => {
      setState(
        produce(({ project }: ProjectSlice) => {
          const draft = project.data.pous.find((pou) => {
            return pou.data.name === pouName
          })
          if (draft) draft.data.documentation = documentation
        }),
      )
    },
    updatePouName: (oldName, newName) => {
      const nextName = (newName ?? '').trim()
      if (!nextName) {
        toast({ title: 'Error', description: 'New name must be non-empty.', variant: 'fail' })
        return
      }
      if (oldName === nextName) return

      setState(
        produce(({ project }: ProjectSlice) => {
          const pou = project.data.pous.find((p) => p.data.name === oldName)
          if (!pou) {
            toast({
              title: 'Error',
              description: `POU with name ${oldName} not found.`,
              variant: 'fail',
            })
            return
          }

          // Prevent collisions with other POUs or Data Types
          const nameClashWithPou = project.data.pous.some((p) => p !== pou && p.data.name === nextName)
          const nameClashWithDatatype = project.data.dataTypes.some((dt) => dt.name === nextName)
          if (nameClashWithPou || nameClashWithDatatype) {
            toast({
              title: 'Invalid name',
              description: `A POU or Data Type named "${nextName}" already exists.`,
              variant: 'fail',
            })
            return
          }

          // Update body block label for LD/FBD networks if applicable
          if ((pou.data.language === 'ld' || pou.data.language === 'fbd') && typeof pou.data.body.value !== 'string') {
            pou.data.body.value.name = nextName
          }

          pou.data.name = nextName
        }),
      )
    },
    applyPouSnapshot: (pouName: string, variables: PLCVariable[], body: unknown): void => {
      setState(
        produce(({ project }: ProjectSlice) => {
          const pou = project.data.pous.find((pou) => pou.data.name === pouName)

          if (!pou) {
            return
          }

          pou.data.variables = variables
          pou.data.body = body as typeof pou.data.body
        }),
      )
    },

    /**
     * Variables Table Actions
     */
    createVariable: (variableToBeCreated): ProjectResponse => {
      let response: ProjectResponse = { ok: true }
      // validate variable name
      const [isNameLegal, reason] = isLegalIdentifier(variableToBeCreated.data.name)
      if (isNameLegal === false) {
        console.error(`'${variableToBeCreated.data.name}' ${reason}`)
        response = {
          ok: false,
          title: 'Illegal Variable Name',
          message: `'${variableToBeCreated.data.name}' ${reason}`,
        }
        return response
      }
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
              }
              if (variableToBeCreated.rowToInsert !== undefined) {
                const pouVariables = pou.data.variables.filter((variable) => variable.name !== 'OUT')
                pouVariables.splice(variableToBeCreated.rowToInsert, 0, variableToBeCreated.data)
                pou.data.variables = [...pouVariables]
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
              const variableToUpdate = getVariableBasedOnRowIdOrVariableId(
                project.data.configuration.resource.globalVariables,
                dataToBeUpdated.rowId,
                undefined,
              )
              if (!variableToUpdate) {
                response = { ok: false, title: 'Variable not found' }
                break
              }
              const index = project.data.configuration.resource.globalVariables.indexOf(variableToUpdate)
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
              const variableToUpdate = getVariableBasedOnRowIdOrVariableId(
                pou.data.variables,
                dataToBeUpdated.rowId,
                dataToBeUpdated.variableId,
              )
              if (!variableToUpdate) {
                response = { ok: false, title: 'Variable not found', message: 'Internal error' }
                break
              }
              const validationResponse = updateVariableValidation(
                pou.data.variables,
                dataToBeUpdated.data,
                variableToUpdate,
              )
              if (!validationResponse.ok) {
                response = validationResponse
                break
              }
              const index = pou.data.variables.indexOf(variableToUpdate)
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
    setPouVariables: (payload) => {
      let response: ProjectResponse = { ok: true }

      setState(
        produce((state: ProjectSlice) => {
          const { pouName, variables } = payload

          const pou = state.project.data.pous.find((p) => p.data.name === pouName)

          if (!pou) {
            response = { ok: false, title: 'POU not Found', message: `The POU named ${pouName} could not be found.` }

            return
          }

          pou.data.variables = variables
        }),
      )

      return response
    },
    setGlobalVariables: (payload: { variables: PLCGlobalVariable[] }): ProjectResponse => {
      const response: ProjectResponse = { ok: true }

      setState(
        produce((state: ProjectSlice) => {
          state.project.data.configuration.resource.globalVariables = payload.variables
        }),
      )

      return response
    },
    getVariable: (variableToGet): PLCVariable | Omit<PLCVariable, 'class'> | undefined => {
      switch (variableToGet.scope) {
        case 'global': {
          const variable = getVariableBasedOnRowIdOrVariableId(
            getState().project.data.configuration.resource.globalVariables,
            variableToGet.rowId,
            variableToGet.variableId,
          )
          if (!variable) {
            return undefined
          }
          return variable
        }

        case 'local': {
          const pou = getState().project.data.pous.find((pou) => pou.data.name === variableToGet.associatedPou)
          if (!pou) {
            console.error(`Pou ${variableToGet.associatedPou} not found`)
            return undefined
          }
          const variable = getVariableBasedOnRowIdOrVariableId(
            pou.data.variables,
            variableToGet.rowId,
            variableToGet.variableId,
          )
          if (!variable) {
            return undefined
          }
          return variable
        }
        default: {
          console.error(`Scope ${variableToGet.scope ? variableToGet.scope : ''} not found or invalid params`)
          return undefined
        }
      }
    },
    deleteVariable: (variableToBeDeleted): ProjectResponse => {
      const { scope } = variableToBeDeleted

      if (scope === 'global') {
        if (variableToBeDeleted.rowId === -1) {
          return { ok: false, title: 'Error', message: 'Invalid row ID' }
        }

        const state = getState()
        let variableToDelete
        if (variableToBeDeleted.variableName) {
          variableToDelete = state.project.data.configuration.resource.globalVariables.find(
            (v) => v.name.toLowerCase() === variableToBeDeleted.variableName?.toLowerCase(),
          )
        } else {
          variableToDelete = getVariableBasedOnRowIdOrVariableId(
            state.project.data.configuration.resource.globalVariables,
            variableToBeDeleted.rowId,
            variableToBeDeleted.variableId,
          )
        }

        if (!variableToDelete) {
          return { ok: false, title: 'Error', message: 'Variable not found' }
        }

        const externalReferences = state.project.data.pous.filter((pou) =>
          pou.data.variables.some(
            (v) => v.class === 'external' && v.name.toLowerCase() === variableToDelete.name.toLowerCase(),
          ),
        )

        if (externalReferences.length > 0) {
          const pouNames = externalReferences.map((pou) => pou.data.name).join(', ')
          return {
            ok: false,
            title: 'Cannot Delete Global Variable',
            message: `The global variable "${variableToDelete.name}" is referenced by external variables in the following POUs: ${pouNames}. Please remove these references before deleting the global variable.`,
          }
        }
      }

      setState(
        produce(({ project }: ProjectSlice) => {
          switch (scope) {
            case 'global': {
              if (variableToBeDeleted.rowId === -1) {
                break
              }

              let variableToDelete
              if (variableToBeDeleted.variableName) {
                variableToDelete = project.data.configuration.resource.globalVariables.find(
                  (v) => v.name.toLowerCase() === variableToBeDeleted.variableName?.toLowerCase(),
                )
              } else {
                variableToDelete = getVariableBasedOnRowIdOrVariableId(
                  project.data.configuration.resource.globalVariables,
                  variableToBeDeleted.rowId,
                  variableToBeDeleted.variableId,
                )
              }

              if (!variableToDelete) {
                return
              }

              const index = project.data.configuration.resource.globalVariables.indexOf(variableToDelete)
              project.data.configuration.resource.globalVariables.splice(index, 1)
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

              if (variableToBeDeleted.variableName) {
                const variable = pou.data.variables.find(
                  (v) => v.name.toLowerCase() === variableToBeDeleted.variableName?.toLowerCase(),
                )
                if (!variable) {
                  return
                }
                const index = pou.data.variables.indexOf(variable)
                pou.data.variables.splice(index, 1)
              } else {
                const variable = getVariableBasedOnRowIdOrVariableId(
                  pou.data.variables,
                  variableToBeDeleted.rowId,
                  variableToBeDeleted.variableId,
                )
                if (!variable) {
                  return
                }
                const index = pou.data.variables.indexOf(variable)
                pou.data.variables.splice(index, 1)
              }
              break
            }
            default: {
              console.error(`Scope ${scope ? scope : ''} not found or invalid params`)
              break
            }
          }
        }),
      )

      return { ok: true }
    },

    rearrangeVariables: (variableToBeRearranged): void => {
      setState(
        produce(({ project }: ProjectSlice) => {
          const { scope } = variableToBeRearranged
          switch (scope) {
            case 'global': {
              const { rowId, variableId, newIndex } = variableToBeRearranged
              const variableToBeRemoved = getVariableBasedOnRowIdOrVariableId(
                project.data.configuration.resource.globalVariables,
                rowId,
                variableId,
              )
              if (!variableToBeRemoved) {
                return
              }
              const index = project.data.configuration.resource.globalVariables.indexOf(variableToBeRemoved)
              const [removed] = project.data.configuration.resource.globalVariables.splice(index, 1)
              project.data.configuration.resource.globalVariables.splice(newIndex, 0, removed)
              break
            }
            case 'local': {
              const pou = project.data.pous.find((pou) => pou.data.name === variableToBeRearranged.associatedPou)
              if (!pou) {
                console.error(`Pou ${variableToBeRearranged.associatedPou} not found`)
                return
              }
              const { rowId, variableId, newIndex } = variableToBeRearranged
              const variableToBeRemoved = getVariableBasedOnRowIdOrVariableId(pou.data.variables, rowId, variableId)
              if (!variableToBeRemoved) {
                return
              }
              const index = pou.data.variables.indexOf(variableToBeRemoved)
              const [removed] = pou.data.variables.splice(index, 1)
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
      let response = { ok: true, message: '', data: null }

      setState(
        produce(({ project }: ProjectSlice) => {
          const { data } = dataToCreate
          const { name } = data

          const dataExists = project.data.dataTypes.find((datatype) => datatype.name === name)
          const pouExists = project.data.pous.find((datatype) => datatype.data.name === name)

          if (!dataExists && !pouExists) {
            project.data.dataTypes.push(data)
            response.message = 'Datatype created successfully.'
            response.ok = true
          } else {
            response = {
              ok: false,
              message: `You can't create a POU and Data type with the same name.`,
              data: null,
            }

            toast({
              title: 'Invalid array',
              description: response.message,
              variant: 'fail',
            })
          }
        }),
      )

      return response
    },
    deleteDatatype: (dataTypeName) => {
      let response: ProjectResponse = { ok: true }
      setState(
        produce(({ project }: ProjectSlice) => {
          const datatypeIndex = project.data.dataTypes.findIndex((datatype) => datatype.name === dataTypeName)
          if (datatypeIndex === -1) {
            response = { ok: false, message: 'Datatype not found' }
            return
          }
          project.data.dataTypes.splice(datatypeIndex, 1)
        }),
      )
      if (!response.ok) {
        toast({
          title: 'Error',
          description: response.message,
          variant: 'fail',
        })
      }
      return response
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
          if (dataToUpdate?.derivation === 'structure' && dataToUpdate.variable) {
            dataToUpdate.variable = dataToUpdate.variable.map((variable) => {
              if (!variable.initialValue) {
                delete variable.initialValue
              }
              return variable
            })
          }
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
        }),
      )
    },
    applyDatatypeSnapshot: (name: string, snapshot: PLCDataType): void => {
      setState(
        produce(({ project }: ProjectSlice) => {
          const index = project.data.dataTypes.findIndex((dataType) => dataType.name === name)

          if (index === -1) {
            return
          }

          project.data.dataTypes[index] = snapshot
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
    setTasks: (payload: { tasks: PLCTask[] }): ProjectResponse => {
      const response: ProjectResponse = { ok: true }

      setState(
        produce(({ project }: ProjectSlice) => {
          const { tasks } = payload

          project.data.configuration.resource.tasks = tasks
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
    setInstances: (payload: { instances: PLCInstance[] }): ProjectResponse => {
      const response: ProjectResponse = { ok: true }

      setState(
        produce(({ project }: ProjectSlice) => {
          const { instances } = payload

          project.data.configuration.resource.instances = instances
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
              const validationResponse = updateInstanceValidation(
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

    /**
     * Server Actions
     */
    createServer: (serverToBeCreated): ProjectResponse => {
      let response: ProjectResponse = { ok: false, message: 'Internal error' }
      setState(
        produce(({ project }: ProjectSlice) => {
          if (!project.data.servers) {
            project.data.servers = []
          }

          const serverExists = project.data.servers.find((server) => server.name === serverToBeCreated.data.name)
          const pouExists = project.data.pous.find((pou) => pou.data.name === serverToBeCreated.data.name)
          const dataTypeExists = project.data.dataTypes.find(
            (datatype) => datatype.name === serverToBeCreated.data.name,
          )
          const protocolExists = project.data.servers.find(
            (server) => server.protocol === serverToBeCreated.data.protocol,
          )

          if (protocolExists) {
            toast({
              title: 'Invalid Server',
              description: `A server for this protocol already exists.`,
              variant: 'fail',
            })
            return
          }

          if (!serverExists && !pouExists && !dataTypeExists) {
            // Initialize protocol-specific config using helper function
            const serverData = initializeServerProtocolConfig({ ...serverToBeCreated.data })
            project.data.servers.push(serverData)
            response = { ok: true, message: 'Server created successfully' }
          } else {
            toast({
              title: 'Invalid Server',
              description: `You can't create a server with this name.`,
              variant: 'fail',
            })
          }
        }),
      )
      return response
    },

    deleteServer: (serverName): ProjectResponse => {
      let response: ProjectResponse = { ok: true }
      setState(
        produce(({ project }: ProjectSlice) => {
          if (!project.data.servers) {
            response = { ok: false, message: 'No servers found' }
            return
          }
          const serverIndex = project.data.servers.findIndex((server) => server.name === serverName)
          if (serverIndex === -1) {
            response = { ok: false, message: 'Server not found' }
            return
          }
          const serverToDelete = project.data.servers[serverIndex]
          if (!project.data.deletedServers) {
            project.data.deletedServers = []
          }
          project.data.deletedServers.push({
            name: serverToDelete.name,
            protocol: serverToDelete.protocol,
          })
          project.data.servers.splice(serverIndex, 1)
        }),
      )
      if (!response.ok) {
        toast({
          title: 'Error',
          description: response.message,
          variant: 'fail',
        })
      }
      return response
    },

    updateServerName: (oldName, newName): ProjectResponse => {
      let response: ProjectResponse = { ok: true }
      setState(
        produce(({ project }: ProjectSlice) => {
          if (!project.data.servers) {
            response = { ok: false, message: 'No servers found' }
            return
          }
          const server = project.data.servers.find((server) => server.name === oldName)
          if (!server) {
            response = { ok: false, message: 'Server not found' }
            return
          }
          const nameExists = project.data.servers.find((s) => s.name === newName && s.name !== oldName)
          const pouExists = project.data.pous.find((pou) => pou.data.name === newName)
          const dataTypeExists = project.data.dataTypes.find((datatype) => datatype.name === newName)
          if (nameExists || pouExists || dataTypeExists) {
            response = { ok: false, message: 'Name already exists' }
            return
          }
          server.name = newName
        }),
      )
      if (!response.ok) {
        toast({
          title: 'Error',
          description: response.message,
          variant: 'fail',
        })
      }
      return response
    },

    updateServerConfig: (
      serverName: string,
      config: {
        enabled?: boolean
        networkInterface?: string
        port?: number
        bufferMapping?: {
          holdingRegisters?: { qwCount?: number; mwCount?: number; mdCount?: number; mlCount?: number }
          coils?: { qxBits?: number; mxBits?: number }
          discreteInputs?: { ixBits?: number }
          inputRegisters?: { iwCount?: number }
        }
      },
    ): ProjectResponse => {
      let response: ProjectResponse = { ok: true }
      setState(
        produce(({ project }: ProjectSlice) => {
          if (!project.data.servers) {
            response = { ok: false, message: 'No servers found' }
            return
          }
          const server = project.data.servers.find((server) => server.name === serverName)
          if (!server) {
            response = { ok: false, message: 'Server not found' }
            return
          }
          if (server.protocol !== 'modbus-tcp') {
            response = { ok: false, message: 'Server is not a Modbus/TCP server' }
            return
          }
          if (!server.modbusSlaveConfig) {
            server.modbusSlaveConfig = {
              enabled: false,
              networkInterface: '0.0.0.0',
              port: 502,
            }
          }
          if (config.enabled !== undefined) server.modbusSlaveConfig.enabled = config.enabled
          if (config.networkInterface !== undefined) server.modbusSlaveConfig.networkInterface = config.networkInterface
          if (config.port !== undefined) server.modbusSlaveConfig.port = config.port

          // Handle buffer mapping updates
          if (config.bufferMapping !== undefined) {
            if (!server.modbusSlaveConfig.bufferMapping) {
              // Initialize with defaults matching runtime BUFFER_SIZE
              server.modbusSlaveConfig.bufferMapping = structuredClone(DEFAULT_BUFFER_MAPPING)
            }
            const bufferMapping = server.modbusSlaveConfig.bufferMapping

            // Update holding registers
            if (config.bufferMapping.holdingRegisters) {
              const hr = config.bufferMapping.holdingRegisters
              if (hr.qwCount !== undefined) bufferMapping.holdingRegisters.qwCount = hr.qwCount
              if (hr.mwCount !== undefined) bufferMapping.holdingRegisters.mwCount = hr.mwCount
              if (hr.mdCount !== undefined) bufferMapping.holdingRegisters.mdCount = hr.mdCount
              if (hr.mlCount !== undefined) bufferMapping.holdingRegisters.mlCount = hr.mlCount
            }

            // Update coils
            if (config.bufferMapping.coils) {
              const c = config.bufferMapping.coils
              if (c.qxBits !== undefined) bufferMapping.coils.qxBits = c.qxBits
              if (c.mxBits !== undefined) bufferMapping.coils.mxBits = c.mxBits
            }

            // Update discrete inputs
            if (config.bufferMapping.discreteInputs) {
              const di = config.bufferMapping.discreteInputs
              if (di.ixBits !== undefined) bufferMapping.discreteInputs.ixBits = di.ixBits
            }

            // Update input registers
            if (config.bufferMapping.inputRegisters) {
              const ir = config.bufferMapping.inputRegisters
              if (ir.iwCount !== undefined) bufferMapping.inputRegisters.iwCount = ir.iwCount
            }
          }
        }),
      )
      return response
    },

    /**
     * S7Comm Server Actions
     */
    updateS7CommServerSettings: (serverName: string, settings: Partial<S7CommServerSettings>): ProjectResponse => {
      let response: ProjectResponse = { ok: true }
      setState(
        produce(({ project }: ProjectSlice) => {
          if (!project.data.servers) {
            response = { ok: false, message: 'No servers found' }
            return
          }
          const server = project.data.servers.find((server) => server.name === serverName)
          if (!server) {
            response = { ok: false, message: 'Server not found' }
            return
          }
          if (server.protocol !== 's7comm') {
            response = { ok: false, message: 'Server is not an S7Comm server' }
            return
          }
          if (!server.s7commSlaveConfig) {
            server.s7commSlaveConfig = {
              server: { ...DEFAULT_S7COMM_SERVER_SETTINGS },
              dataBlocks: [],
            }
          }
          // Update server settings using Object.assign for cleaner code
          Object.assign(server.s7commSlaveConfig.server, settings)
        }),
      )
      return response
    },

    updateS7CommPlcIdentity: (serverName: string, identity: Partial<S7CommPlcIdentity>): ProjectResponse => {
      let response: ProjectResponse = { ok: true }
      setState(
        produce(({ project }: ProjectSlice) => {
          if (!project.data.servers) {
            response = { ok: false, message: 'No servers found' }
            return
          }
          const server = project.data.servers.find((server) => server.name === serverName)
          if (!server || server.protocol !== 's7comm' || !server.s7commSlaveConfig) {
            response = { ok: false, message: 'S7Comm server not found' }
            return
          }
          if (!server.s7commSlaveConfig.plcIdentity) {
            server.s7commSlaveConfig.plcIdentity = { ...DEFAULT_S7COMM_PLC_IDENTITY }
          }
          if (identity.name !== undefined) server.s7commSlaveConfig.plcIdentity.name = identity.name
          if (identity.moduleType !== undefined) server.s7commSlaveConfig.plcIdentity.moduleType = identity.moduleType
          if (identity.serialNumber !== undefined)
            server.s7commSlaveConfig.plcIdentity.serialNumber = identity.serialNumber
          if (identity.copyright !== undefined) server.s7commSlaveConfig.plcIdentity.copyright = identity.copyright
          if (identity.moduleName !== undefined) server.s7commSlaveConfig.plcIdentity.moduleName = identity.moduleName
        }),
      )
      return response
    },

    addS7CommDataBlock: (serverName: string, dataBlock: S7CommDataBlock): ProjectResponse => {
      let response: ProjectResponse = { ok: true }
      setState(
        produce(({ project }: ProjectSlice) => {
          if (!project.data.servers) {
            response = { ok: false, message: 'No servers found' }
            return
          }
          const server = project.data.servers.find((server) => server.name === serverName)
          if (!server || server.protocol !== 's7comm' || !server.s7commSlaveConfig) {
            response = { ok: false, message: 'S7Comm server not found' }
            return
          }
          // Check for duplicate DB number
          const dbExists = server.s7commSlaveConfig.dataBlocks.some((db) => db.dbNumber === dataBlock.dbNumber)
          if (dbExists) {
            response = { ok: false, message: `Data block DB${dataBlock.dbNumber} already exists` }
            toast({
              title: 'Invalid Data Block',
              description: `Data block DB${dataBlock.dbNumber} already exists.`,
              variant: 'fail',
            })
            return
          }
          // Check max data blocks limit
          if (server.s7commSlaveConfig.dataBlocks.length >= 64) {
            response = { ok: false, message: 'Maximum number of data blocks (64) reached' }
            toast({
              title: 'Limit Reached',
              description: 'Maximum number of data blocks (64) reached.',
              variant: 'fail',
            })
            return
          }
          server.s7commSlaveConfig.dataBlocks.push(dataBlock)
        }),
      )
      return response
    },

    updateS7CommDataBlock: (
      serverName: string,
      dbNumber: number,
      updates: Partial<S7CommDataBlock>,
    ): ProjectResponse => {
      let response: ProjectResponse = { ok: true }
      setState(
        produce(({ project }: ProjectSlice) => {
          if (!project.data.servers) {
            response = { ok: false, message: 'No servers found' }
            return
          }
          const server = project.data.servers.find((server) => server.name === serverName)
          if (!server || server.protocol !== 's7comm' || !server.s7commSlaveConfig) {
            response = { ok: false, message: 'S7Comm server not found' }
            return
          }
          const dataBlock = server.s7commSlaveConfig.dataBlocks.find((db) => db.dbNumber === dbNumber)
          if (!dataBlock) {
            response = { ok: false, message: 'Data block not found' }
            return
          }
          // Check for duplicate DB number if changing
          if (updates.dbNumber !== undefined && updates.dbNumber !== dbNumber) {
            const dbExists = server.s7commSlaveConfig.dataBlocks.some((db) => db.dbNumber === updates.dbNumber)
            if (dbExists) {
              response = { ok: false, message: `Data block DB${updates.dbNumber} already exists` }
              toast({
                title: 'Invalid Data Block',
                description: `Data block DB${updates.dbNumber} already exists.`,
                variant: 'fail',
              })
              return
            }
          }
          if (updates.dbNumber !== undefined) dataBlock.dbNumber = updates.dbNumber
          if (updates.description !== undefined) dataBlock.description = updates.description
          if (updates.sizeBytes !== undefined) dataBlock.sizeBytes = updates.sizeBytes
          if (updates.mapping !== undefined) dataBlock.mapping = updates.mapping
        }),
      )
      return response
    },

    removeS7CommDataBlock: (serverName: string, dbNumber: number): ProjectResponse => {
      let response: ProjectResponse = { ok: true }
      setState(
        produce(({ project }: ProjectSlice) => {
          if (!project.data.servers) {
            response = { ok: false, message: 'No servers found' }
            return
          }
          const server = project.data.servers.find((server) => server.name === serverName)
          if (!server || server.protocol !== 's7comm' || !server.s7commSlaveConfig) {
            response = { ok: false, message: 'S7Comm server not found' }
            return
          }
          const index = server.s7commSlaveConfig.dataBlocks.findIndex((db) => db.dbNumber === dbNumber)
          if (index === -1) {
            response = { ok: false, message: 'Data block not found' }
            return
          }
          server.s7commSlaveConfig.dataBlocks.splice(index, 1)
        }),
      )
      return response
    },

    updateS7CommSystemArea: (
      serverName: string,
      area: 'peArea' | 'paArea' | 'mkArea',
      config: Partial<S7CommSystemArea>,
    ): ProjectResponse => {
      let response: ProjectResponse = { ok: true }
      setState(
        produce(({ project }: ProjectSlice) => {
          if (!project.data.servers) {
            response = { ok: false, message: 'No servers found' }
            return
          }
          const server = project.data.servers.find((server) => server.name === serverName)
          if (!server || server.protocol !== 's7comm' || !server.s7commSlaveConfig) {
            response = { ok: false, message: 'S7Comm server not found' }
            return
          }
          if (!server.s7commSlaveConfig.systemAreas) {
            server.s7commSlaveConfig.systemAreas = {}
          }
          if (!server.s7commSlaveConfig.systemAreas[area]) {
            server.s7commSlaveConfig.systemAreas[area] = {
              enabled: false,
              sizeBytes: 128,
            }
          }
          const systemArea = server.s7commSlaveConfig.systemAreas[area]
          if (config.enabled !== undefined) systemArea.enabled = config.enabled
          if (config.sizeBytes !== undefined) systemArea.sizeBytes = config.sizeBytes
          if (config.mapping !== undefined) systemArea.mapping = config.mapping
        }),
      )
      return response
    },

    updateS7CommLogging: (serverName: string, logging: Partial<S7CommLogging>): ProjectResponse => {
      let response: ProjectResponse = { ok: true }
      setState(
        produce(({ project }: ProjectSlice) => {
          if (!project.data.servers) {
            response = { ok: false, message: 'No servers found' }
            return
          }
          const server = project.data.servers.find((server) => server.name === serverName)
          if (!server || server.protocol !== 's7comm' || !server.s7commSlaveConfig) {
            response = { ok: false, message: 'S7Comm server not found' }
            return
          }
          if (!server.s7commSlaveConfig.logging) {
            server.s7commSlaveConfig.logging = { ...DEFAULT_S7COMM_LOGGING }
          }
          if (logging.logConnections !== undefined)
            server.s7commSlaveConfig.logging.logConnections = logging.logConnections
          if (logging.logDataAccess !== undefined)
            server.s7commSlaveConfig.logging.logDataAccess = logging.logDataAccess
          if (logging.logErrors !== undefined) server.s7commSlaveConfig.logging.logErrors = logging.logErrors
        }),
      )
      return response
    },

    /**
     * OPC-UA Server Actions
     */
    updateOpcUaServerConfig: (serverName, configUpdate): ProjectResponse => {
      let response: ProjectResponse = { ok: true }
      setState(
        produce(({ project }: ProjectSlice) => {
          if (!project.data.servers) {
            response = { ok: false, message: 'No servers found' }
            return
          }
          const server = project.data.servers.find((s) => s.name === serverName)
          if (!server) {
            response = { ok: false, message: 'Server not found' }
            return
          }
          if (server.protocol !== 'opcua') {
            response = { ok: false, message: 'Server is not an OPC-UA server' }
            return
          }
          if (!server.opcuaServerConfig) {
            response = { ok: false, message: 'OPC-UA configuration not found' }
            return
          }

          // Deep merge the config update
          const mergeDeep = (target: Record<string, unknown>, source: Record<string, unknown>) => {
            for (const key of Object.keys(source)) {
              if (source[key] !== undefined) {
                if (
                  source[key] &&
                  typeof source[key] === 'object' &&
                  !Array.isArray(source[key]) &&
                  target[key] &&
                  typeof target[key] === 'object' &&
                  !Array.isArray(target[key])
                ) {
                  mergeDeep(target[key] as Record<string, unknown>, source[key] as Record<string, unknown>)
                } else {
                  target[key] = source[key]
                }
              }
            }
          }

          mergeDeep(
            server.opcuaServerConfig as unknown as Record<string, unknown>,
            configUpdate as unknown as Record<string, unknown>,
          )
        }),
      )
      return response
    },

    addOpcUaSecurityProfile: (serverName: string, profile: OpcUaSecurityProfile): ProjectResponse => {
      let response: ProjectResponse = { ok: true }
      setState(
        produce(({ project }: ProjectSlice) => {
          if (!project.data.servers) {
            response = { ok: false, message: 'No servers found' }
            return
          }
          const server = project.data.servers.find((s) => s.name === serverName)
          if (!server || server.protocol !== 'opcua' || !server.opcuaServerConfig) {
            response = { ok: false, message: 'OPC-UA server not found' }
            return
          }
          // Check for duplicate profile name
          const nameExists = server.opcuaServerConfig.securityProfiles.some(
            (p) => p.name.toLowerCase() === profile.name.toLowerCase(),
          )
          if (nameExists) {
            response = { ok: false, message: `A security profile named "${profile.name}" already exists` }
            toast({
              title: 'Invalid Security Profile',
              description: `A security profile named "${profile.name}" already exists.`,
              variant: 'fail',
            })
            return
          }
          server.opcuaServerConfig.securityProfiles.push(profile)
        }),
      )
      return response
    },

    updateOpcUaSecurityProfile: (
      serverName: string,
      profileId: string,
      updates: Partial<OpcUaSecurityProfile>,
    ): ProjectResponse => {
      let response: ProjectResponse = { ok: true }
      setState(
        produce(({ project }: ProjectSlice) => {
          if (!project.data.servers) {
            response = { ok: false, message: 'No servers found' }
            return
          }
          const server = project.data.servers.find((s) => s.name === serverName)
          if (!server || server.protocol !== 'opcua' || !server.opcuaServerConfig) {
            response = { ok: false, message: 'OPC-UA server not found' }
            return
          }
          const profile = server.opcuaServerConfig.securityProfiles.find((p) => p.id === profileId)
          if (!profile) {
            response = { ok: false, message: 'Security profile not found' }
            return
          }
          // Check for duplicate name if changing
          if (updates.name !== undefined && updates.name.toLowerCase() !== profile.name.toLowerCase()) {
            const nameExists = server.opcuaServerConfig.securityProfiles.some(
              (p) => p.id !== profileId && p.name.toLowerCase() === updates.name!.toLowerCase(),
            )
            if (nameExists) {
              response = { ok: false, message: `A security profile named "${updates.name}" already exists` }
              toast({
                title: 'Invalid Security Profile',
                description: `A security profile named "${updates.name}" already exists.`,
                variant: 'fail',
              })
              return
            }
          }
          Object.assign(profile, updates)
        }),
      )
      return response
    },

    removeOpcUaSecurityProfile: (serverName: string, profileId: string): ProjectResponse => {
      let response: ProjectResponse = { ok: true }
      setState(
        produce(({ project }: ProjectSlice) => {
          if (!project.data.servers) {
            response = { ok: false, message: 'No servers found' }
            return
          }
          const server = project.data.servers.find((s) => s.name === serverName)
          if (!server || server.protocol !== 'opcua' || !server.opcuaServerConfig) {
            response = { ok: false, message: 'OPC-UA server not found' }
            return
          }
          const index = server.opcuaServerConfig.securityProfiles.findIndex((p) => p.id === profileId)
          if (index === -1) {
            response = { ok: false, message: 'Security profile not found' }
            return
          }
          // Prevent deleting the last profile
          if (server.opcuaServerConfig.securityProfiles.length <= 1) {
            response = { ok: false, message: 'At least one security profile is required' }
            toast({
              title: 'Cannot Delete Profile',
              description: 'At least one security profile must exist.',
              variant: 'fail',
            })
            return
          }
          server.opcuaServerConfig.securityProfiles.splice(index, 1)
        }),
      )
      return response
    },

    /**
     * OPC-UA User Actions
     */
    addOpcUaUser: (serverName: string, user: OpcUaUser): ProjectResponse => {
      let response: ProjectResponse = { ok: true }
      setState(
        produce(({ project }: ProjectSlice) => {
          if (!project.data.servers) {
            response = { ok: false, message: 'No servers found' }
            return
          }
          const server = project.data.servers.find((s) => s.name === serverName)
          if (!server || server.protocol !== 'opcua' || !server.opcuaServerConfig) {
            response = { ok: false, message: 'OPC-UA server not found' }
            return
          }
          // Check for duplicate username (for password users)
          if (user.type === 'password' && user.username) {
            const usernameExists = server.opcuaServerConfig.users.some(
              (u) => u.type === 'password' && u.username?.toLowerCase() === user.username?.toLowerCase(),
            )
            if (usernameExists) {
              response = { ok: false, message: `A user with username "${user.username}" already exists` }
              toast({
                title: 'Invalid User',
                description: `A user with username "${user.username}" already exists.`,
                variant: 'fail',
              })
              return
            }
          }
          // Check for duplicate certificate binding (for certificate users)
          if (user.type === 'certificate' && user.certificateId) {
            const certBindingExists = server.opcuaServerConfig.users.some(
              (u) => u.type === 'certificate' && u.certificateId === user.certificateId,
            )
            if (certBindingExists) {
              response = { ok: false, message: `A user is already bound to this certificate` }
              toast({
                title: 'Invalid User',
                description: 'A user is already bound to this certificate.',
                variant: 'fail',
              })
              return
            }
          }
          server.opcuaServerConfig.users.push(user)
        }),
      )
      return response
    },

    updateOpcUaUser: (serverName: string, userId: string, updates: Partial<OpcUaUser>): ProjectResponse => {
      let response: ProjectResponse = { ok: true }
      setState(
        produce(({ project }: ProjectSlice) => {
          if (!project.data.servers) {
            response = { ok: false, message: 'No servers found' }
            return
          }
          const server = project.data.servers.find((s) => s.name === serverName)
          if (!server || server.protocol !== 'opcua' || !server.opcuaServerConfig) {
            response = { ok: false, message: 'OPC-UA server not found' }
            return
          }
          const user = server.opcuaServerConfig.users.find((u) => u.id === userId)
          if (!user) {
            response = { ok: false, message: 'User not found' }
            return
          }
          // Check for duplicate username if changing
          if (updates.username !== undefined && updates.username !== user.username) {
            const usernameExists = server.opcuaServerConfig.users.some(
              (u) =>
                u.id !== userId &&
                u.type === 'password' &&
                u.username?.toLowerCase() === updates.username?.toLowerCase(),
            )
            if (usernameExists) {
              response = { ok: false, message: `A user with username "${updates.username}" already exists` }
              toast({
                title: 'Invalid User',
                description: `A user with username "${updates.username}" already exists.`,
                variant: 'fail',
              })
              return
            }
          }
          Object.assign(user, updates)
        }),
      )
      return response
    },

    removeOpcUaUser: (serverName: string, userId: string): ProjectResponse => {
      let response: ProjectResponse = { ok: true }
      setState(
        produce(({ project }: ProjectSlice) => {
          if (!project.data.servers) {
            response = { ok: false, message: 'No servers found' }
            return
          }
          const server = project.data.servers.find((s) => s.name === serverName)
          if (!server || server.protocol !== 'opcua' || !server.opcuaServerConfig) {
            response = { ok: false, message: 'OPC-UA server not found' }
            return
          }
          const index = server.opcuaServerConfig.users.findIndex((u) => u.id === userId)
          if (index === -1) {
            response = { ok: false, message: 'User not found' }
            return
          }
          server.opcuaServerConfig.users.splice(index, 1)
        }),
      )
      return response
    },

    /**
     * OPC-UA Certificate Actions
     */
    updateOpcUaServerCertificateStrategy: (
      serverName: string,
      strategy: 'auto_self_signed' | 'custom',
      customCert?: string | null,
      customKey?: string | null,
    ): ProjectResponse => {
      let response: ProjectResponse = { ok: true }
      setState(
        produce(({ project }: ProjectSlice) => {
          if (!project.data.servers) {
            response = { ok: false, message: 'No servers found' }
            return
          }
          const server = project.data.servers.find((s) => s.name === serverName)
          if (!server || server.protocol !== 'opcua' || !server.opcuaServerConfig) {
            response = { ok: false, message: 'OPC-UA server not found' }
            return
          }
          server.opcuaServerConfig.security.serverCertificateStrategy = strategy
          if (strategy === 'custom') {
            server.opcuaServerConfig.security.serverCertificateCustom = customCert ?? null
            server.opcuaServerConfig.security.serverPrivateKeyCustom = customKey ?? null
          } else {
            server.opcuaServerConfig.security.serverCertificateCustom = null
            server.opcuaServerConfig.security.serverPrivateKeyCustom = null
          }
        }),
      )
      return response
    },

    addOpcUaTrustedCertificate: (serverName: string, certificate: OpcUaTrustedCertificate): ProjectResponse => {
      let response: ProjectResponse = { ok: true }
      setState(
        produce(({ project }: ProjectSlice) => {
          if (!project.data.servers) {
            response = { ok: false, message: 'No servers found' }
            return
          }
          const server = project.data.servers.find((s) => s.name === serverName)
          if (!server || server.protocol !== 'opcua' || !server.opcuaServerConfig) {
            response = { ok: false, message: 'OPC-UA server not found' }
            return
          }
          // Check for duplicate certificate ID
          const idExists = server.opcuaServerConfig.security.trustedClientCertificates.some(
            (c) => c.id.toLowerCase() === certificate.id.toLowerCase(),
          )
          if (idExists) {
            response = { ok: false, message: `A certificate with ID "${certificate.id}" already exists` }
            toast({
              title: 'Invalid Certificate',
              description: `A certificate with ID "${certificate.id}" already exists.`,
              variant: 'fail',
            })
            return
          }
          server.opcuaServerConfig.security.trustedClientCertificates.push(certificate)
        }),
      )
      return response
    },

    removeOpcUaTrustedCertificate: (serverName: string, certificateId: string): ProjectResponse => {
      let response: ProjectResponse = { ok: true }
      setState(
        produce(({ project }: ProjectSlice) => {
          if (!project.data.servers) {
            response = { ok: false, message: 'No servers found' }
            return
          }
          const server = project.data.servers.find((s) => s.name === serverName)
          if (!server || server.protocol !== 'opcua' || !server.opcuaServerConfig) {
            response = { ok: false, message: 'OPC-UA server not found' }
            return
          }
          // Check if any user is bound to this certificate
          const userBound = server.opcuaServerConfig.users.find(
            (u) => u.type === 'certificate' && u.certificateId === certificateId,
          )
          if (userBound) {
            response = { ok: false, message: 'Cannot delete certificate that is bound to a user' }
            toast({
              title: 'Cannot Delete Certificate',
              description: 'This certificate is bound to a user. Remove the user first.',
              variant: 'fail',
            })
            return
          }
          const index = server.opcuaServerConfig.security.trustedClientCertificates.findIndex(
            (c) => c.id === certificateId,
          )
          if (index === -1) {
            response = { ok: false, message: 'Certificate not found' }
            return
          }
          server.opcuaServerConfig.security.trustedClientCertificates.splice(index, 1)
        }),
      )
      return response
    },

    /**
     * OPC-UA Address Space Node Actions
     */
    updateOpcUaAddressSpaceNamespace: (serverName: string, namespaceUri: string): ProjectResponse => {
      let response: ProjectResponse = { ok: true }
      setState(
        produce(({ project }: ProjectSlice) => {
          if (!project.data.servers) {
            response = { ok: false, message: 'No servers found' }
            return
          }
          const server = project.data.servers.find((s) => s.name === serverName)
          if (!server || server.protocol !== 'opcua' || !server.opcuaServerConfig) {
            response = { ok: false, message: 'OPC-UA server not found' }
            return
          }
          server.opcuaServerConfig.addressSpace.namespaceUri = namespaceUri
        }),
      )
      return response
    },

    addOpcUaNode: (serverName: string, node: OpcUaNodeConfig): ProjectResponse => {
      let response: ProjectResponse = { ok: true }
      setState(
        produce(({ project }: ProjectSlice) => {
          if (!project.data.servers) {
            response = { ok: false, message: 'No servers found' }
            return
          }
          const server = project.data.servers.find((s) => s.name === serverName)
          if (!server || server.protocol !== 'opcua' || !server.opcuaServerConfig) {
            response = { ok: false, message: 'OPC-UA server not found' }
            return
          }
          // Check for duplicate node ID
          const nodeIdExists = server.opcuaServerConfig.addressSpace.nodes.some(
            (n) => n.nodeId.toLowerCase() === node.nodeId.toLowerCase(),
          )
          if (nodeIdExists) {
            response = { ok: false, message: `A node with ID "${node.nodeId}" already exists` }
            toast({
              title: 'Invalid Node',
              description: `A node with ID "${node.nodeId}" already exists.`,
              variant: 'fail',
            })
            return
          }
          server.opcuaServerConfig.addressSpace.nodes.push(node)
        }),
      )
      return response
    },

    updateOpcUaNode: (serverName: string, nodeId: string, updates: Partial<OpcUaNodeConfig>): ProjectResponse => {
      let response: ProjectResponse = { ok: true }
      setState(
        produce(({ project }: ProjectSlice) => {
          if (!project.data.servers) {
            response = { ok: false, message: 'No servers found' }
            return
          }
          const server = project.data.servers.find((s) => s.name === serverName)
          if (!server || server.protocol !== 'opcua' || !server.opcuaServerConfig) {
            response = { ok: false, message: 'OPC-UA server not found' }
            return
          }
          const nodeIndex = server.opcuaServerConfig.addressSpace.nodes.findIndex((n) => n.id === nodeId)
          if (nodeIndex === -1) {
            response = { ok: false, message: 'Node not found' }
            return
          }
          // If updating nodeId, check for duplicate
          if (updates.nodeId) {
            const currentNode = server.opcuaServerConfig.addressSpace.nodes[nodeIndex]
            if (updates.nodeId !== currentNode.nodeId) {
              const nodeIdExists = server.opcuaServerConfig.addressSpace.nodes.some(
                (n, i) => i !== nodeIndex && n.nodeId.toLowerCase() === updates.nodeId!.toLowerCase(),
              )
              if (nodeIdExists) {
                response = { ok: false, message: `A node with ID "${updates.nodeId}" already exists` }
                toast({
                  title: 'Invalid Node ID',
                  description: `A node with ID "${updates.nodeId}" already exists.`,
                  variant: 'fail',
                })
                return
              }
            }
          }
          Object.assign(server.opcuaServerConfig.addressSpace.nodes[nodeIndex], updates)
        }),
      )
      return response
    },

    removeOpcUaNode: (serverName: string, nodeId: string): ProjectResponse => {
      let response: ProjectResponse = { ok: true }
      setState(
        produce(({ project }: ProjectSlice) => {
          if (!project.data.servers) {
            response = { ok: false, message: 'No servers found' }
            return
          }
          const server = project.data.servers.find((s) => s.name === serverName)
          if (!server || server.protocol !== 'opcua' || !server.opcuaServerConfig) {
            response = { ok: false, message: 'OPC-UA server not found' }
            return
          }
          const index = server.opcuaServerConfig.addressSpace.nodes.findIndex((n) => n.id === nodeId)
          if (index === -1) {
            response = { ok: false, message: 'Node not found' }
            return
          }
          server.opcuaServerConfig.addressSpace.nodes.splice(index, 1)
        }),
      )
      return response
    },

    /**
     * Remote Device Actions
     */
    createRemoteDevice: (remoteDeviceToBeCreated): ProjectResponse => {
      let response: ProjectResponse = { ok: false, message: 'Internal error' }
      setState(
        produce(({ project }: ProjectSlice) => {
          if (!project.data.remoteDevices) {
            project.data.remoteDevices = []
          }

          const deviceExists = project.data.remoteDevices.find(
            (device) => device.name === remoteDeviceToBeCreated.data.name,
          )
          const pouExists = project.data.pous.find((pou) => pou.data.name === remoteDeviceToBeCreated.data.name)
          const dataTypeExists = project.data.dataTypes.find(
            (datatype) => datatype.name === remoteDeviceToBeCreated.data.name,
          )

          if (!deviceExists && !pouExists && !dataTypeExists) {
            project.data.remoteDevices.push(remoteDeviceToBeCreated.data)
            response = { ok: true, message: 'Remote device created successfully' }
          } else {
            toast({
              title: 'Invalid Remote Device',
              description: `You can't create a remote device with this name.`,
              variant: 'fail',
            })
          }
        }),
      )
      return response
    },

    deleteRemoteDevice: (deviceName): ProjectResponse => {
      let response: ProjectResponse = { ok: true }
      setState(
        produce(({ project }: ProjectSlice) => {
          if (!project.data.remoteDevices) {
            response = { ok: false, message: 'No remote devices found' }
            return
          }
          const deviceIndex = project.data.remoteDevices.findIndex((device) => device.name === deviceName)
          if (deviceIndex === -1) {
            response = { ok: false, message: 'Remote device not found' }
            return
          }
          const deviceToDelete = project.data.remoteDevices[deviceIndex]
          if (!project.data.deletedRemoteDevices) {
            project.data.deletedRemoteDevices = []
          }
          project.data.deletedRemoteDevices.push({
            name: deviceToDelete.name,
            protocol: deviceToDelete.protocol,
          })
          project.data.remoteDevices.splice(deviceIndex, 1)
        }),
      )
      if (!response.ok) {
        toast({
          title: 'Error',
          description: response.message,
          variant: 'fail',
        })
      }
      return response
    },

    updateRemoteDeviceName: (oldName, newName): ProjectResponse => {
      let response: ProjectResponse = { ok: true }
      setState(
        produce(({ project }: ProjectSlice) => {
          if (!project.data.remoteDevices) {
            response = { ok: false, message: 'No remote devices found' }
            return
          }
          const device = project.data.remoteDevices.find((device) => device.name === oldName)
          if (!device) {
            response = { ok: false, message: 'Remote device not found' }
            return
          }
          const nameExists = project.data.remoteDevices.find((d) => d.name === newName && d.name !== oldName)
          const pouExists = project.data.pous.find((pou) => pou.data.name === newName)
          const dataTypeExists = project.data.dataTypes.find((datatype) => datatype.name === newName)
          if (nameExists || pouExists || dataTypeExists) {
            response = { ok: false, message: 'Name already exists' }
            return
          }
          device.name = newName
        }),
      )
      if (!response.ok) {
        toast({
          title: 'Error',
          description: response.message,
          variant: 'fail',
        })
      }
      return response
    },

    updateRemoteDeviceConfig: (
      deviceName: string,
      config: { host?: string; port?: number; timeout?: number },
    ): ProjectResponse => {
      let response: ProjectResponse = { ok: true }
      setState(
        produce(({ project }: ProjectSlice) => {
          if (!project.data.remoteDevices) {
            response = { ok: false, message: 'No remote devices found' }
            return
          }
          const device = project.data.remoteDevices.find((device) => device.name === deviceName)
          if (!device) {
            response = { ok: false, message: 'Remote device not found' }
            return
          }
          if (device.protocol !== 'modbus-tcp') {
            response = { ok: false, message: 'Device is not a Modbus/TCP device' }
            return
          }
          if (!device.modbusTcpConfig) {
            device.modbusTcpConfig = {
              host: '127.0.0.1',
              port: 502,
              timeout: 1000,
              ioGroups: [],
            }
          }
          if (config.host !== undefined) device.modbusTcpConfig.host = config.host
          if (config.port !== undefined) device.modbusTcpConfig.port = config.port
          if (config.timeout !== undefined) device.modbusTcpConfig.timeout = config.timeout
        }),
      )
      return response
    },

    addIOGroup: (
      deviceName: string,
      ioGroup: {
        id: string
        name: string
        functionCode: '1' | '2' | '3' | '4' | '5' | '6' | '15' | '16'
        cycleTime: number
        offset: string
        length: number
        errorHandling: 'keep-last-value' | 'set-to-zero'
      },
    ): ProjectResponse => {
      let response: ProjectResponse = { ok: true }
      setState(
        produce(({ project }: ProjectSlice) => {
          if (!project.data.remoteDevices) {
            response = { ok: false, message: 'No remote devices found' }
            return
          }
          const device = project.data.remoteDevices.find((device) => device.name === deviceName)
          if (!device) {
            response = { ok: false, message: 'Remote device not found' }
            return
          }
          if (device.protocol !== 'modbus-tcp') {
            response = { ok: false, message: 'Device is not a Modbus/TCP device' }
            return
          }
          if (!device.modbusTcpConfig) {
            device.modbusTcpConfig = {
              host: '127.0.0.1',
              port: 502,
              timeout: 1000,
              ioGroups: [],
            }
          }
          const usedAddresses = new Set<string>()
          for (const remoteDevice of project.data.remoteDevices) {
            if (remoteDevice.modbusTcpConfig?.ioGroups) {
              for (const group of remoteDevice.modbusTcpConfig.ioGroups) {
                for (const point of group.ioPoints) {
                  usedAddresses.add(point.iecLocation)
                }
              }
            }
          }
          const ioPoints = generateIOPoints(ioGroup.functionCode, ioGroup.length, ioGroup.name, usedAddresses)
          device.modbusTcpConfig.ioGroups.push({
            ...ioGroup,
            ioPoints,
          })
        }),
      )
      return response
    },

    updateIOGroup: (
      deviceName: string,
      ioGroupId: string,
      updates: {
        name?: string
        functionCode?: '1' | '2' | '3' | '4' | '5' | '6' | '15' | '16'
        cycleTime?: number
        offset?: string
        length?: number
        errorHandling?: 'keep-last-value' | 'set-to-zero'
      },
    ): ProjectResponse => {
      let response: ProjectResponse = { ok: true }
      setState(
        produce(({ project }: ProjectSlice) => {
          if (!project.data.remoteDevices) {
            response = { ok: false, message: 'No remote devices found' }
            return
          }
          const device = project.data.remoteDevices.find((device) => device.name === deviceName)
          if (!device || !device.modbusTcpConfig) {
            response = { ok: false, message: 'Remote device not found' }
            return
          }
          const ioGroup = device.modbusTcpConfig.ioGroups.find((group) => group.id === ioGroupId)
          if (!ioGroup) {
            response = { ok: false, message: 'IO Group not found' }
            return
          }
          if (updates.name !== undefined) ioGroup.name = updates.name
          if (updates.functionCode !== undefined) ioGroup.functionCode = updates.functionCode
          if (updates.cycleTime !== undefined) ioGroup.cycleTime = updates.cycleTime
          if (updates.offset !== undefined) ioGroup.offset = updates.offset
          if (updates.length !== undefined) ioGroup.length = updates.length
          if (updates.errorHandling !== undefined) ioGroup.errorHandling = updates.errorHandling
          if (updates.functionCode !== undefined || updates.length !== undefined || updates.name !== undefined) {
            const usedAddresses = new Set<string>()
            for (const remoteDevice of project.data.remoteDevices) {
              if (remoteDevice.modbusTcpConfig?.ioGroups) {
                for (const group of remoteDevice.modbusTcpConfig.ioGroups) {
                  if (group.id === ioGroupId) continue
                  for (const point of group.ioPoints) {
                    usedAddresses.add(point.iecLocation)
                  }
                }
              }
            }
            ioGroup.ioPoints = generateIOPoints(ioGroup.functionCode, ioGroup.length, ioGroup.name, usedAddresses)
          }
        }),
      )
      return response
    },

    deleteIOGroup: (deviceName: string, ioGroupId: string): ProjectResponse => {
      let response: ProjectResponse = { ok: true }
      setState(
        produce(({ project }: ProjectSlice) => {
          if (!project.data.remoteDevices) {
            response = { ok: false, message: 'No remote devices found' }
            return
          }
          const device = project.data.remoteDevices.find((device) => device.name === deviceName)
          if (!device || !device.modbusTcpConfig) {
            response = { ok: false, message: 'Remote device not found' }
            return
          }
          const index = device.modbusTcpConfig.ioGroups.findIndex((group) => group.id === ioGroupId)
          if (index === -1) {
            response = { ok: false, message: 'IO Group not found' }
            return
          }
          device.modbusTcpConfig.ioGroups.splice(index, 1)
        }),
      )
      return response
    },

    updateIOPointAlias: (deviceName: string, ioGroupId: string, ioPointId: string, alias: string): ProjectResponse => {
      let response: ProjectResponse = { ok: true }
      setState(
        produce(({ project }: ProjectSlice) => {
          if (!project.data.remoteDevices) {
            response = { ok: false, message: 'No remote devices found' }
            return
          }
          const device = project.data.remoteDevices.find((device) => device.name === deviceName)
          if (!device || !device.modbusTcpConfig) {
            response = { ok: false, message: 'Remote device not found' }
            return
          }
          const ioGroup = device.modbusTcpConfig.ioGroups.find((group) => group.id === ioGroupId)
          if (!ioGroup) {
            response = { ok: false, message: 'IO Group not found' }
            return
          }
          const ioPoint = ioGroup.ioPoints.find((point) => point.id === ioPointId)
          if (!ioPoint) {
            response = { ok: false, message: 'IO Point not found' }
            return
          }
          ioPoint.alias = alias
        }),
      )
      return response
    },
  },
})

export { createProjectSlice }
