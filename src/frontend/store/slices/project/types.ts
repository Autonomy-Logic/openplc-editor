import type {
  EthercatConfig,
  ModbusBufferMapping,
  ModbusIOGroup,
  OpcUaNodeConfig,
  OpcUaSecurityProfile,
  OpcUaTrustedCertificate,
  OpcUaUser,
  PLCBody,
  PLCDataType,
  PLCFunction,
  PLCFunctionBlock,
  PLCInstance,
  PLCProgram,
  PLCProjectData,
  PLCRemoteDevice,
  PLCServer,
  PLCStructureVariable,
  PLCTask,
  PLCVariable,
  ProjectMeta,
  S7CommDataBlock,
  S7CommLogging,
  S7CommPlcIdentity,
  S7CommServerSettings,
  S7CommSystemArea,
} from '../../../../middleware/shared/ports/types'

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export type VariableDTO = {
  scope: 'global' | 'local'
  associatedPou?: string
  data: PLCVariable
}

export type StructureVariableDTO = {
  associatedDataType?: string
  data: PLCStructureVariable
}

export type PouDTO =
  | { type: 'program'; data: PLCProgram }
  | { type: 'function'; data: PLCFunction }
  | { type: 'function-block'; data: PLCFunctionBlock }

export type DataTypeDTO = {
  data: PLCDataType
}

export type TaskDTO = {
  data: PLCTask
}

export type InstanceDTO = {
  data: PLCInstance
}

export type ServerDTO = {
  data: PLCServer
}

export type RemoteDeviceDTO = {
  data: PLCRemoteDevice
}

// ---------------------------------------------------------------------------
// Project State
// ---------------------------------------------------------------------------

export type ProjectState = {
  meta: ProjectMeta
  data: PLCProjectData
}

export type ProjectResponse = {
  ok: boolean
  title?: string
  message?: string
  data?: unknown
}

// ---------------------------------------------------------------------------
// Project Actions
// ---------------------------------------------------------------------------

export type ProjectActions = {
  // Project state
  setProject: (state: ProjectState) => void
  setPous: (pous: PLCProjectData['pous']) => void
  clearProjects: () => void
  clearPendingDeletions: () => void

  // Meta
  updateMetaName: (name: string) => void
  updateMetaPath: (path: string) => void

  // POU
  createPou: (dto: PouDTO) => ProjectResponse
  updatePou: (args: { name: string; content: PLCBody }) => void
  deletePou: (name: string) => void
  updatePouDocumentation: (name: string, documentation: string) => void
  updatePouReturnType: (name: string, returnType: string) => void
  clearPouVariablesText: (name: string) => void
  updatePouName: (oldName: string, newName: string) => void
  applyPouSnapshot: (name: string, variables: PLCVariable[], body: PLCBody) => void

  // Variables
  createVariable: (dto: Omit<VariableDTO, 'data'> & { data: PLCVariable; rowToInsert?: number }) => ProjectResponse
  setPouVariables: (args: { pouName: string; variables: PLCVariable[] }) => ProjectResponse
  setGlobalVariables: (args: { variables: PLCVariable[] }) => ProjectResponse
  updateVariable: (args: {
    scope: 'global' | 'local'
    associatedPou?: string
    rowId?: number
    variableId?: string
    data: Partial<PLCVariable>
  }) => ProjectResponse
  getVariable: (args: {
    scope: 'global' | 'local'
    associatedPou?: string
    rowId?: number
    variableId?: string
  }) => PLCVariable | undefined
  deleteVariable: (args: {
    scope: 'global' | 'local'
    associatedPou?: string
    rowId?: number
    variableId?: string
    variableName?: string
  }) => ProjectResponse
  rearrangeVariables: (args: {
    scope: 'global' | 'local'
    associatedPou?: string
    rowId?: number
    variableId?: string
    newIndex: number
  }) => void

  // Data types
  createDatatype: (dto: DataTypeDTO & { rowToInsert?: number }) => ProjectResponse
  deleteDatatype: (name: string) => void
  updateDatatype: (name: string, data?: PLCDataType) => void
  createArrayDimension: (args: { name: string; derivation: 'array' | 'enumerated' | 'structure' }) => void
  rearrangeStructureVariables: (args: { associatedDataType?: string; rowId: number; newIndex: number }) => void
  applyDatatypeSnapshot: (name: string, data: PLCDataType) => void

  // Tasks
  createTask: (dto: TaskDTO & { rowToInsert?: number }) => ProjectResponse
  setTasks: (args: { tasks: PLCTask[] }) => ProjectResponse
  updateTask: (dto: TaskDTO & { rowId: number }) => ProjectResponse
  deleteTask: (args: { rowId: number }) => void
  rearrangeTasks: (args: { rowId: number; newIndex: number }) => void

  // Instances
  createInstance: (dto: InstanceDTO & { rowToInsert?: number }) => ProjectResponse
  setInstances: (args: { instances: PLCInstance[] }) => ProjectResponse
  updateInstance: (dto: InstanceDTO & { rowId: number }) => ProjectResponse
  deleteInstance: (args: { rowId: number }) => void
  rearrangeInstances: (args: { rowId: number; newIndex: number }) => void

  // Servers
  createServer: (dto: ServerDTO) => ProjectResponse
  deleteServer: (name: string) => ProjectResponse
  updateServerName: (name: string, newName: string) => ProjectResponse
  updateServerConfig: (
    name: string,
    config: {
      enabled?: boolean
      networkInterface?: string
      port?: number
      bufferMapping?: Partial<ModbusBufferMapping>
    },
  ) => ProjectResponse

  // S7Comm
  updateS7CommServerSettings: (name: string, settings: Partial<S7CommServerSettings>) => ProjectResponse
  updateS7CommPlcIdentity: (name: string, identity: Partial<S7CommPlcIdentity>) => ProjectResponse
  addS7CommDataBlock: (name: string, block: S7CommDataBlock) => ProjectResponse
  updateS7CommDataBlock: (name: string, index: number, block: Partial<S7CommDataBlock>) => ProjectResponse
  removeS7CommDataBlock: (name: string, index: number) => ProjectResponse
  updateS7CommSystemArea: (
    name: string,
    area: 'peArea' | 'paArea' | 'mkArea',
    config: Partial<S7CommSystemArea>,
  ) => ProjectResponse
  updateS7CommLogging: (name: string, logging: Partial<S7CommLogging>) => ProjectResponse

  // OPC-UA
  updateOpcUaServerConfig: (name: string, config: Record<string, unknown>) => ProjectResponse
  addOpcUaSecurityProfile: (name: string, profile: OpcUaSecurityProfile) => ProjectResponse
  updateOpcUaSecurityProfile: (
    name: string,
    profileId: string,
    updates: Partial<OpcUaSecurityProfile>,
  ) => ProjectResponse
  removeOpcUaSecurityProfile: (name: string, profileId: string) => ProjectResponse
  addOpcUaUser: (name: string, user: OpcUaUser) => ProjectResponse
  updateOpcUaUser: (name: string, userId: string, updates: Partial<OpcUaUser>) => ProjectResponse
  removeOpcUaUser: (name: string, userId: string) => ProjectResponse
  updateOpcUaServerCertificateStrategy: (
    name: string,
    strategy: 'auto_self_signed' | 'custom',
    certificate?: string | null,
    privateKey?: string | null,
  ) => ProjectResponse
  addOpcUaTrustedCertificate: (name: string, cert: OpcUaTrustedCertificate) => ProjectResponse
  removeOpcUaTrustedCertificate: (name: string, certId: string) => ProjectResponse
  updateOpcUaAddressSpaceNamespace: (name: string, namespace: string) => ProjectResponse
  addOpcUaNode: (name: string, node: OpcUaNodeConfig) => ProjectResponse
  updateOpcUaNode: (name: string, nodeId: string, updates: Partial<OpcUaNodeConfig>) => ProjectResponse
  removeOpcUaNode: (name: string, nodeId: string) => ProjectResponse

  // Remote devices
  createRemoteDevice: (dto: RemoteDeviceDTO) => ProjectResponse
  deleteRemoteDevice: (name: string) => ProjectResponse
  updateRemoteDeviceName: (name: string, newName: string) => ProjectResponse
  updateRemoteDeviceConfig: (
    name: string,
    config: {
      transport?: 'tcp' | 'rtu'
      host?: string
      port?: number
      serialPort?: string
      baudRate?: number
      parity?: 'N' | 'E' | 'O'
      stopBits?: number
      dataBits?: number
      timeout?: number
      slaveId?: number
    },
  ) => ProjectResponse
  addIOGroup: (deviceName: string, group: ModbusIOGroup) => ProjectResponse
  updateIOGroup: (
    deviceName: string,
    groupId: string,
    updates: Partial<Omit<ModbusIOGroup, 'id' | 'ioPoints'>>,
  ) => ProjectResponse
  deleteIOGroup: (deviceName: string, groupId: string) => ProjectResponse
  updateIOPointAlias: (deviceName: string, groupId: string, pointId: string, alias: string) => ProjectResponse
  updateEthercatConfig: (deviceName: string, ethercatConfig: EthercatConfig) => ProjectResponse
}

// ---------------------------------------------------------------------------
// Slice
// ---------------------------------------------------------------------------

export type ProjectSlice = {
  project: ProjectState
  /** Relative file paths queued for deletion on next full project save. */
  pendingDeletions: string[]
  projectActions: ProjectActions
}
