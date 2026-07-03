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

  /** Replace the in-memory `library.json` content.  Library projects
   *  only — POU bodies use `updatePou` for the same flow.  The
   *  manifest editor calls this on every Monaco edit; the save
   *  pipeline serialises it to `library.json` via the standard
   *  iterator (no separate save path). */
  updateLibraryManifest: (content: string) => void

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

  /**
   * Central, capability-scoped recalculation via the IEC address registry.
   * Derives consumers from live producer state, restores aliases the session
   * memory remembers for reappeared channels, re-packs the allocatable
   * producers (VPP + Modbus today; closing gaps project-wide) while holding
   * pins / EtherCAT as fixed constraints, writes the addresses + aliases back
   * onto every producer, and reconciles bound variables. Invoked after every
   * producer mutation and on target switch.
   */
  recalculateIecAddresses: () => ProjectResponse

  /**
   * Record (or clear, when `alias` is empty) an alias in the session memory
   * keyed by a channel's stable semantic identity (see `iecAliasMemory`).
   * Called from every producer's alias editor so the alias returns if the
   * producer is removed and re-added within the session.
   */
  rememberChannelAlias: (memoryKey: string, alias: string) => ProjectResponse

  /**
   * Compile-time alias resolution (editor-side; the compiler/runtime never
   * see aliases). Returns a COPY of the project data with every variable's
   * `location` resolved to a concrete IEC address: an alias name → its
   * current address, a literal `%addr` → verbatim, a missing/orphaned alias
   * → '' (unlocated). The store keeps the alias-name form for display.
   */
  getCompileReadyProjectData: () => ProjectState['data']

  /**
   * Cascade-rename bound variables' `location` from `oldAlias` to `newAlias`
   * across all POU-local and global variables. In the single-field model a
   * variable bound to a producer alias holds the alias NAME in `location`;
   * when the user renames (or clears) that alias on the producer channel
   * (pin mapping, VPP module, Modbus TCP, EtherCAT), the bound variables must
   * follow so they keep resolving at compile time.
   *
   * Empty `oldAlias` is a no-op (first-time alias write — nothing to cascade).
   * Empty `newAlias` (clearing the alias) sets the matching variables'
   * `location` to '' — they become unlocated, matching the compile-time
   * "missing alias → empty location" rule. Exact (case-sensitive) match,
   * since the alias registry that resolves names at compile is case-sensitive.
   *
   * Returns the number of variables actually mutated.
   */
  renameAlias: (oldAlias: string, newAlias: string) => { renamed: number }

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
  /**
   * Session-scoped IEC alias memory: `memoryKey -> alias`, where `memoryKey`
   * is a channel's stable semantic identity (`vpp:moduleId:slot:channel`,
   * `modbus:device:group:point`, …). Lets a removed producer's aliases return
   * when the same one is re-added within a session. NEVER serialized — reset
   * on project load; only current addresses/aliases are saved to disk.
   */
  iecAliasMemory: Record<string, string>
  projectActions: ProjectActions
}

/**
 * Cross-slice root-state view the project slice needs at runtime —
 * `setDeviceDefinitions` / `setVendorScreenData` lives in the device
 * slice, `addLog` lives in the console slice, both consumed by the
 * alias-sync flow. Keeps the slice creator's `getState()` typed
 * properly instead of relying on `as unknown as { ... }` casts.
 *
 * Slice types are imported via dynamic `type-only` style — declared
 * up here in `types.ts` rather than `slice.ts` so the project slice
 * has a single source of truth for cross-slice shape without
 * circular module deps.
 */
import type { ConsoleSlice } from '../console'
import type { DeviceSlice } from '../device'
import type { EditorSlice } from '../editor/types'
import type { LibrarySlice } from '../library/types'

export type ProjectSliceRoot = ProjectSlice & DeviceSlice & ConsoleSlice & EditorSlice & LibrarySlice
