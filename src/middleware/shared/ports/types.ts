/**
 * Shared domain types used by port interfaces.
 *
 * These types are platform-agnostic and represent the domain concepts
 * shared between openplc-editor (Electron) and openplc-web (Browser).
 * Inner layers (domain/application) depend on these; outer layers (adapters)
 * implement the ports that use them.
 */

// ---------------------------------------------------------------------------
// Result wrappers
// ---------------------------------------------------------------------------

/** Standard result for operations that can fail */
export type Result<T = void> = ({ success: true } & T) | { success: false; error: string }

/** Unsubscribe function returned by event subscriptions */
export type Unsubscribe = () => void

// ---------------------------------------------------------------------------
// PLC Languages & POU
// ---------------------------------------------------------------------------

export type PLCLanguage = 'IL' | 'ST' | 'LD' | 'FBD' | 'SFC'

/** Extended languages supported by function blocks */
export type PLCExtendedLanguage = PLCLanguage | 'python' | 'cpp'

export type PouType = 'program' | 'function' | 'function-block'

export type VariableClass = 'input' | 'output' | 'inOut' | 'external' | 'local' | 'temp' | 'global'

export type VariableTypeDefinition = 'base-type' | 'user-data-type' | 'array' | 'derived'

export interface PLCVariableType {
  definition: VariableTypeDefinition
  value: string
  data?: {
    baseType: { definition: 'base-type' | 'user-data-type'; value: string }
    dimensions: Array<{ dimension: string }>
  }
}

export interface PLCVariable {
  id?: string
  name: string
  class?: VariableClass
  type: PLCVariableType
  location: string
  initialValue?: string | null
  documentation: string
  debug?: boolean
}

export interface PLCTask {
  name: string
  triggering: 'Cyclic' | 'Interrupt'
  interval: string
  priority: number
  isSystemTask?: boolean
  associatedDevice?: string
}

export interface PLCInstance {
  name: string
  task: string
  program: string
}

export interface PLCStructureVariable {
  name: string
  type: PLCVariableType
  initialValue?: { simpleValue: { value: string } }
  documentation?: string
}

export type PLCDataType =
  | { name: string; derivation: 'structure'; variable: PLCStructureVariable[] }
  | {
      name: string
      derivation: 'enumerated'
      initialValue?: string
      values: Array<{ description: string }>
    }
  | {
      name: string
      derivation: 'array'
      baseType: PLCVariableType
      initialValue?: string
      dimensions: Array<{ dimension: string }>
    }

export interface PLCBody {
  language: PLCExtendedLanguage | 'il' | 'st' | 'ld' | 'fbd' | 'sfc' | 'python' | 'cpp'
  value: unknown
}

export interface PLCPou {
  name: string
  pouType: PouType
  interface?: {
    returnType?: string
    variables: PLCVariable[]
  }
  body: PLCBody
  documentation?: string
}

// ---------------------------------------------------------------------------
// POU Variants (used by project store)
// ---------------------------------------------------------------------------

export type PouLanguage = 'il' | 'st' | 'ld' | 'sfc' | 'fbd' | 'python' | 'cpp'

export interface PLCFunction {
  language: PouLanguage
  name: string
  returnType: string
  variables: PLCVariable[]
  body: PLCBody
  documentation: string
  variablesText?: string
}

export interface PLCFunctionBlock {
  language: PouLanguage
  name: string
  variables: PLCVariable[]
  body: PLCBody
  documentation: string
  variablesText?: string
}

export interface PLCProgram {
  language: PouLanguage
  name: string
  variables: PLCVariable[]
  body: PLCBody
  documentation: string
  variablesText?: string
}

export interface PLCGlobalVariable extends Omit<PLCVariable, 'class'> {
  class: 'global'
}

// ---------------------------------------------------------------------------
// Servers & Communication Protocols
// ---------------------------------------------------------------------------

export type ServerProtocol = 'modbus-tcp' | 's7comm' | 'ethernet-ip' | 'opcua'
export type RemoteDeviceProtocol = 'modbus-tcp' | 'ethernet-ip' | 'ethercat' | 'profinet'

// Modbus
export interface ModbusSlaveConfig {
  enabled: boolean
  networkInterface: string
  port: number
  bufferMapping?: ModbusBufferMapping
}

export interface ModbusBufferMapping {
  holdingRegisters?: { qwCount?: number; mwCount?: number; mdCount?: number; mlCount?: number }
  coils?: { qxBits?: number; mxBits?: number }
  discreteInputs?: { ixBits?: number }
  inputRegisters?: { iwCount?: number }
}

export interface ModbusIOPoint {
  id: string
  name: string
  type: string
  iecLocation: string
  alias?: string
}

export interface ModbusIOGroup {
  id: string
  name: string
  functionCode: '1' | '2' | '3' | '4' | '5' | '6' | '15' | '16'
  cycleTime: number
  offset: string
  length: number
  errorHandling: 'keep-last-value' | 'set-to-zero'
  ioPoints?: ModbusIOPoint[]
}

export interface ModbusRemoteTcpConfig {
  transport?: 'tcp' | 'rtu'
  host?: string
  port?: number
  serialPort?: string
  baudRate?: number
  parity?: 'N' | 'E' | 'O'
  stopBits?: number
  dataBits?: number
  slaveId?: number
  timeout: number
  ioGroups: ModbusIOGroup[]
}

// S7Comm
export interface S7CommServerSettings {
  enabled: boolean
  bindAddress: string
  port: number
  maxClients: number
  workIntervalMs: number
  sendTimeoutMs: number
  recvTimeoutMs: number
  pingTimeoutMs: number
  pduSize: number
}

export interface S7CommPlcIdentity {
  name: string
  moduleType: string
  serialNumber: string
  copyright: string
  moduleName: string
}

export type S7CommBufferType =
  | 'input'
  | 'output'
  | 'memory'
  | 'bool_input'
  | 'bool_output'
  | 'bool_memory'
  | 'byte_input'
  | 'byte_output'
  | 'int_input'
  | 'int_output'
  | 'int_memory'
  | 'dint_input'
  | 'dint_output'
  | 'dint_memory'
  | 'lint_input'
  | 'lint_output'
  | 'lint_memory'

export interface S7CommBufferMapping {
  type: S7CommBufferType
  startBuffer: number
  bitAddressing: boolean
}

export interface S7CommDataBlock {
  dbNumber: number
  description: string
  sizeBytes: number
  mapping: S7CommBufferMapping
}

export interface S7CommSystemArea {
  enabled: boolean
  sizeBytes: number
  mapping?: S7CommBufferMapping
}

export interface S7CommSystemAreas {
  peArea?: S7CommSystemArea
  paArea?: S7CommSystemArea
  mkArea?: S7CommSystemArea
}

export interface S7CommLogging {
  logConnections: boolean
  logDataAccess: boolean
  logErrors: boolean
}

export interface S7CommSlaveConfig {
  server: S7CommServerSettings
  plcIdentity?: S7CommPlcIdentity
  dataBlocks: S7CommDataBlock[]
  systemAreas?: S7CommSystemAreas
  logging?: S7CommLogging
}

// OPC-UA
export interface OpcUaServerSettings {
  enabled: boolean
  name: string
  applicationUri: string
  productUri: string
  bindAddress: string
  port: number
  endpointPath: string
}

export type OpcUaSecurityPolicyType = 'None' | 'Basic128Rsa15' | 'Basic256' | 'Basic256Sha256'
export type OpcUaSecurityModeType = 'None' | 'Sign' | 'SignAndEncrypt'
export type OpcUaAuthMethod = 'Anonymous' | 'Username' | 'Certificate'

export interface OpcUaSecurityProfile {
  id: string
  name: string
  enabled: boolean
  securityPolicy: OpcUaSecurityPolicyType
  securityMode: OpcUaSecurityModeType
  authMethods: OpcUaAuthMethod[]
}

export interface OpcUaUser {
  id: string
  type: 'password' | 'certificate'
  username: string | null
  passwordHash: string | null
  certificateId: string | null
  role: 'viewer' | 'operator' | 'engineer'
}

export interface OpcUaTrustedCertificate {
  id: string
  pem: string
  subject?: string
  validFrom?: string
  validTo?: string
  fingerprint?: string
}

export type OpcUaPermission = 'r' | 'w' | 'rw'

export interface OpcUaPermissions {
  viewer: OpcUaPermission
  operator: OpcUaPermission
  engineer: OpcUaPermission
}

export interface OpcUaFieldConfig {
  fieldPath: string
  displayName: string
  datatype?: string
  initialValue: boolean | number | string
  permissions: OpcUaPermissions
  fields?: OpcUaFieldConfig[]
}

export interface OpcUaNodeConfig {
  id: string
  pouName: string
  variablePath: string
  variableType: string
  nodeId: string
  browseName: string
  displayName: string
  description: string
  initialValue: boolean | number | string
  permissions: OpcUaPermissions
  nodeType: 'variable' | 'structure' | 'array'
  fields?: OpcUaFieldConfig[]
  arrayLength?: number
  elementType?: string
}

export interface OpcUaAddressSpaceConfig {
  namespaceUri: string
  nodes: OpcUaNodeConfig[]
}

export interface OpcUaSecurityConfig {
  serverCertificateStrategy: 'auto_self_signed' | 'custom'
  serverCertificateCustom: string | null
  serverPrivateKeyCustom: string | null
  trustedClientCertificates: OpcUaTrustedCertificate[]
}

export interface OpcUaServerConfig {
  server: OpcUaServerSettings
  securityProfiles: OpcUaSecurityProfile[]
  security: OpcUaSecurityConfig
  users: OpcUaUser[]
  cycleTimeMs: number
  addressSpace: OpcUaAddressSpaceConfig
}

// PLCServer
export interface PLCServer {
  name: string
  protocol: ServerProtocol
  modbusSlaveConfig?: ModbusSlaveConfig
  s7commSlaveConfig?: S7CommSlaveConfig
  opcuaServerConfig?: OpcUaServerConfig
}

// PLCRemoteDevice
export interface PLCRemoteDevice {
  name: string
  protocol: RemoteDeviceProtocol
  modbusTcpConfig?: ModbusRemoteTcpConfig
  ethercatConfig?: {
    masterConfig?: {
      networkInterface: string
      cycleTimeUs: number
      watchdogTimeoutCycles?: number
    }
    devices: Array<{
      id: string
      name: string
      channelMappings: Array<{
        channelId: string
        iecLocation: string
        userEdited: boolean
        alias?: string
      }>
      [key: string]: unknown
    }>
  }
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export interface PLCProjectData {
  dataTypes: PLCDataType[]
  pous: PLCPou[]
  configurations: {
    resource: {
      tasks: PLCTask[]
      instances: PLCInstance[]
      globalVariables: PLCVariable[]
    }
  }
  servers?: PLCServer[]
  remoteDevices?: PLCRemoteDevice[]
  debugVariables?: {
    global?: string[]
    pous?: Record<string, string[]>
  }
}

/** Alias used by Monaco completion providers */
export type PLCProject = PLCProjectData

export interface ProjectMeta {
  name: string
  type: 'plc-project' | 'plc-library'
  path: string
}

// ---------------------------------------------------------------------------
// Device & Board
// ---------------------------------------------------------------------------

export type CompilerType = 'arduino-cli' | 'openplc-compiler' | 'simulator'

export interface BoardInfo {
  compiler: CompilerType | (string & {})
  core: string
  preview: string
  specs: Record<string, string>
  coreVersion?: string
  pins?: {
    defaultAin?: string[]
    defaultAout?: string[]
    defaultDin?: string[]
    defaultDout?: string[]
  }
}

export interface CommunicationPort {
  name: string
  address: string
}

export interface SerialPort {
  device: string
  description?: string
}

export type PinType = 'digitalInput' | 'digitalOutput' | 'analogInput' | 'analogOutput'

export interface DevicePin {
  pin: string
  pinType: PinType
  address: string
  name?: string
}

export interface ModbusRTUConfig {
  rtuInterface: string
  rtuBaudRate: string
  rtuSlaveId: number | null
  rtuRS485ENPin: string | null
}

export interface ModbusTCPConfig {
  tcpInterface: string
  tcpMacAddress: string | null
  tcpWifiSSID?: string | null
  tcpWifiPassword?: string | null
  tcpStaticHostConfiguration: {
    ipAddress: string
    dns: string
    gateway: string
    subnet: string
  }
}

export interface DeviceConfiguration {
  deviceBoard: string
  communicationPort: string
  runtimeIpAddress?: string
  compileOnly: boolean
  communicationConfiguration: {
    modbusRTU: ModbusRTUConfig
    modbusTCP: ModbusTCPConfig
    communicationPreferences: {
      enabledRTU: boolean
      enabledTCP: boolean
      enabledDHCP: boolean
    }
  }
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

export type PlcStatus = 'INIT' | 'RUNNING' | 'STOPPED' | 'ERROR' | 'EMPTY' | 'UNKNOWN'

export interface TimingStats {
  scan_count: number
  scan_time_min: number | null
  scan_time_max: number | null
  scan_time_avg: number | null
  cycle_time_min: number | null
  cycle_time_max: number | null
  cycle_time_avg: number | null
  cycle_latency_min: number | null
  cycle_latency_max: number | null
  cycle_latency_avg: number | null
  overruns: number
}

export type RuntimeLogLevel = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR'

export interface RuntimeLogEntry {
  id: number | null
  timestamp: string
  level: RuntimeLogLevel
  message: string
}

// ---------------------------------------------------------------------------
// Debugger
// ---------------------------------------------------------------------------

export type DebugConnectionType = 'tcp' | 'rtu' | 'websocket' | 'simulator'

export interface DebugConnectionConfig {
  connectionType: DebugConnectionType
  connectionParams: {
    ipAddress?: string
    port?: string
    baudRate?: number
    slaveId?: number
    jwtToken?: string
  }
}

export interface DebugVariableResult {
  success: boolean
  tick?: number
  lastIndex?: number
  data?: number[]
  error?: string
  needsReconnect?: boolean
}

export interface DebugSetResult {
  success: boolean
  error?: string
}

export interface Md5VerifyResult {
  success: boolean
  match?: boolean
  targetMd5?: string
  error?: string
}

// ---------------------------------------------------------------------------
// Simulator Debug
// ---------------------------------------------------------------------------

export interface SimulatorDebugResult {
  success: boolean
  tick?: number
  lastIndex?: number
  data?: string // hex string
  error?: string
}

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

export interface CompileProgressEvent {
  stage: 'xml' | 'st' | 'c' | 'glue' | 'arduino' | 'upload' | 'done' | 'error'
  message: string
  progress?: number
  level?: string
  firmwarePath?: string
  plcStatus?: string
}

export interface CompileResult {
  success: boolean
  message?: string
  hexPath?: string
  /** Generated Structured Text program — available for runtime upload after compilation. */
  programSt?: string
  error?: string
}

export interface DebugCompileResult {
  success: boolean
  debugContent?: string
  md5?: string
  error?: string
}

// ---------------------------------------------------------------------------
// Debugger Tree
// ---------------------------------------------------------------------------

/** Function Block Instance Info — represents a specific FB instance for debugging */
export interface FbInstanceInfo {
  fbTypeName: string
  programName: string
  programInstanceName: string
  fbVariableName: string
  key: string
}

/** Debug Tree Node — represents a node in the hierarchical debugger variable tree */
export interface DebugTreeNode {
  name: string
  fullPath: string
  compositeKey: string
  type: string
  isComplex: boolean
  isExpanded?: boolean
  children?: DebugTreeNode[]
  debugIndex?: number
  arrayIndices?: number[]
}

// ---------------------------------------------------------------------------
// PLC Logs
// ---------------------------------------------------------------------------

/** Union type representing logs from either v3 (string) or v4 (array) runtime */
export type PlcLogs = string | RuntimeLogEntry[]

/** Maximum number of log entries to keep in the client-side buffer */
export const LOG_BUFFER_CAP = 1000

/** Type guard to check if logs are in v4 format (array of objects) */
export function isV4Logs(logs: PlcLogs): logs is RuntimeLogEntry[] {
  return Array.isArray(logs)
}

/** Type guard to check if logs are in v3 format (plain string) */
export function isV3Logs(logs: PlcLogs): logs is string {
  return typeof logs === 'string'
}

// ---------------------------------------------------------------------------
// Console
// ---------------------------------------------------------------------------

export interface LogObject {
  id: string
  level?: 'debug' | 'info' | 'warning' | 'error'
  message: string
  tstamp?: Date
}

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------

export type Platform = 'linux' | 'darwin' | 'win32' | ''

export type Architecture = 'x64' | 'arm' | ''

export interface SystemInfo {
  OS: Platform
  architecture: Architecture
  prefersDarkMode: boolean
  isWindowMaximized: boolean
}

export interface RecentProject {
  name: string
  path: string
  lastOpenedAt: string
  createdAt: string
}

// ---------------------------------------------------------------------------
// AI Feature
// ---------------------------------------------------------------------------

/**
 * Platform-provided configuration for the AI feature.
 * Resolved by the composition root from environment variables and persistent storage.
 */
export interface AIFeatureConfig {
  /** Whether the AI feature is enabled on this platform */
  isFeatureEnabled: boolean
  /** Whether the user has previously consented to AI usage */
  hasUserConsented: boolean
}

// ---------------------------------------------------------------------------
// AI Chat
// ---------------------------------------------------------------------------

export type ChatMessageRole = 'user' | 'assistant'

export type ChatMessage = {
  id: string
  role: ChatMessageRole
  content: string
  timestamp: number
  rating?: 'up' | 'down'
}

// ---------------------------------------------------------------------------
// Graphical Editor Flow Data Shapes
// ---------------------------------------------------------------------------

/**
 * FBD rung data — nodes + edges for one Function Block Diagram rung.
 * Used by both the store slice and the compiler adapter.
 */
export type FBDRungState = {
  comment: string
  selectedNodes: import('@xyflow/react').Node[]
  nodes: import('@xyflow/react').Node[]
  edges: import('@xyflow/react').Edge[]
}

/**
 * Ladder rung data — nodes + edges + layout for one Ladder rung.
 * Used by both the store slice and the compiler adapter.
 */
export type RungLadderState = {
  id: string
  comment: string
  defaultBounds: number[]
  reactFlowViewport: number[]
  selectedNodes: import('@xyflow/react').Node[]
  nodes: import('@xyflow/react').Node[]
  edges: import('@xyflow/react').Edge[]
}

// ---------------------------------------------------------------------------
// WebRTC
// ---------------------------------------------------------------------------

export type WebRTCConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error' | 'failed'

/** Narrow callback interface for the WebRTC connection manager. */
export interface WebRTCSessionCallbacks {
  setStatus: (status: WebRTCConnectionStatus) => void
  setError: (error: string | null) => void
  setSessionId: (id: string | null) => void
  setReconnectAttempt: (attempt: number) => void
  startSession: (params: { deviceId: string; deviceName: string; agentId: string }) => void
  endSession: () => void
}

// ---------------------------------------------------------------------------
// Variable Reference
// ---------------------------------------------------------------------------

/** Composite key for identifying a variable reference in the system */
export type VariableReference = {
  pouName: string
  variableName: string
  variableType: PLCVariableType
}
