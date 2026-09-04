import type { RawProjectFile } from '../../../../middleware/shared/ports/project-port'
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

/**
 * Which set of variables an action works on.
 *
 * A Global Variable List's members are variables in the same sense a POU's locals and the
 * resource globals are: same fields, same validation, same table in the UI. They are a third
 * scope on the existing actions rather than a parallel set of list-specific ones, so the
 * declaration editor and the table view cannot drift apart.
 */
export type VariableScope = 'global' | 'local' | 'global-variable-list'

export type VariableDTO = {
  scope: VariableScope
  associatedPou?: string
  /** Required for `global-variable-list` scope: which list's members to work on. */
  associatedList?: string
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
    scope: VariableScope
    associatedPou?: string
    associatedList?: string
    rowId?: number
    variableId?: string
    data: Partial<PLCVariable>
  }) => ProjectResponse
  getVariable: (args: {
    scope: VariableScope
    associatedPou?: string
    associatedList?: string
    rowId?: number
    variableId?: string
  }) => PLCVariable | undefined
  deleteVariable: (args: {
    scope: VariableScope
    associatedPou?: string
    associatedList?: string
    rowId?: number
    variableId?: string
    variableName?: string
    /**
     * Global scope only. When a global is referenced as `VAR_EXTERNAL` by any
     * POU, deletion is refused by default and the response carries the
     * referencing POU names in `data.referencingPous`. Pass `force: true` to
     * cascade-delete: remove the global AND the matching external declaration
     * from every referencing POU.
     */
    force?: boolean
  }) => ProjectResponse
  rearrangeVariables: (args: {
    scope: VariableScope
    associatedPou?: string
    associatedList?: string
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
   * The live `alias → IEC address` index derived from every active producer
   * (pin mapping, VPP module slots, Modbus TCP remote IO, EtherCAT channels).
   *
   * Exposed for consumers that must project variables into IEC text the way
   * the compiler sees them — currently the ST language server, whose stub and
   * scope-query documents would otherwise emit `AT <alias>` and fail to parse.
   * Memoized on producer-state identity, so the LSP can call it on every
   * project reconcile without rebuilding the address registry.
   */
  getAliasIndex: () => ReadonlyMap<string, string>

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

  // Global variable lists — the object CODESYS calls a GVL.
  // Every lookup here folds case: the name is an IEC identifier once compiled.
  /** Create an empty list. Fails when one already carries that name. */
  createGlobalVariableList: (name: string) => ProjectResponse
  /** Remove the list. It lives in `project.json`, so there is no file to queue. */
  deleteGlobalVariableList: (name: string) => void
  /** Replace a list's variables wholesale — how the code view commits. */
  updateGlobalVariableList: (name: string, variables: PLCVariable[]) => void
  /** Set or clear the `VAR_GLOBAL` qualifier carried for the round trip, never compiled. */
  updateGlobalVariableListQualifier: (name: string, qualifier: string | undefined) => void
  /** Rename the list itself; references are `propagateGlobalVariableListRename`'s job. */
  updateGlobalVariableListName: (oldName: string, newName: string) => void
  /** Clone the whole record under a new name — no field is copied by hand. */
  duplicateGlobalVariableList: (sourceName: string, newName: string) => ProjectResponse
  /** Rewrite every `<oldName>.member` in every POU body, textual or graphical. */
  propagateGlobalVariableListRename: (oldName: string, newName: string) => void
  /** Fold the code view's pending buffer into the list. Fails when it does not parse. */
  reconcileGlobalVariableListText: (name: string) => ProjectResponse
  /** Rewrite the code view's buffer from the list. No-op when that view isn't open. */
  regenerateGlobalVariableListText: (name: string) => void

  // Data types
  createDatatype: (dto: DataTypeDTO & { rowToInsert?: number }) => ProjectResponse
  deleteDatatype: (name: string) => void
  updateDatatype: (name: string, data?: PLCDataType) => void
  /** Rename + queue the old `datatypes/<oldName>.dt` path for deletion
   *  (model: `updatePouName`).  Reference propagation is
   *  `propagateDatatypeRename`, driven by `datatypeActions.rename`. */
  updateDatatypeName: (oldName: string, newName: string) => void
  /** Rewrite every reference to data type `oldName` (POU variables, global
   *  variables, other data types' fields / array base types) to `newName`.
   *  Does not touch the type's own entry — `updateDatatypeName` owns that. */
  propagateDatatypeRename: (oldName: string, newName: string) => void
  createArrayDimension: (args: { name: string; derivation: 'array' | 'enumerated' | 'structure' }) => void
  rearrangeStructureVariables: (args: { associatedDataType?: string; rowId: number; newIndex: number }) => void
  applyDatatypeSnapshot: (name: string, data: PLCDataType) => void
  /** Fold a diverged `.dt` code buffer back into the type before an
   *  external mutation; refuses (`ok: false`) when the text is invalid. */
  reconcileDatatypeText: (name: string) => ProjectResponse
  /** Re-serialize the type into its code buffer after an external mutation. */
  regenerateDatatypeText: (name: string) => void
  /** Stash raw `.dt` files that failed to parse on load so saves echo
   *  them back verbatim (no silent data loss). */
  setUnparsedDataTypeFiles: (files: RawProjectFile[]) => void
  setDataTypesNeedMigration: (needsMigration: boolean) => void
  /** Drop a preserved raw file once its text parses and becomes a real type. */
  removeUnparsedDataTypeFile: (relativePath: string) => void

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
  /** Raw `datatypes/*.dt` files that failed to parse on load.  Echoed
   *  back verbatim by the save flow until they parse — an unreadable
   *  file must never be silently dropped from disk. */
  unparsedDataTypeFiles: RawProjectFile[]
  /** True while the project still carries its data types inline in
   *  `project.json` with no `datatypes/*.dt` on disk. A single-file save of one
   *  data type migrates the whole set while this is set, so the project is
   *  never left half in one format and half in the other. */
  dataTypesNeedMigration: boolean
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
