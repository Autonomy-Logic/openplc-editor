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
export type Result<T = void> = { success: true } & T | { success: false; error: string }

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
    baseType: string
    dimensions: Array<{ dimension: string }>
  }
}

export interface PLCVariable {
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
}

export interface PLCInstance {
  name: string
  taskName: string
  pouName: string
}

export type PLCDataType =
  | { name: string; derivation: 'structure'; variable: PLCVariable[] }
  | {
      name: string
      derivation: 'enumerated'
      initialValue?: string
      values: Array<{ description: string }>
    }
  | {
      name: string
      derivation: 'array'
      baseType: string
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
}

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
  compiler: CompilerType | string
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
// Compiler
// ---------------------------------------------------------------------------

export interface CompileProgressEvent {
  stage: 'xml' | 'st' | 'c' | 'glue' | 'arduino' | 'done' | 'error'
  message: string
  progress?: number
}

export interface CompileResult {
  success: boolean
  message?: string
  hexPath?: string
  error?: string
}

export interface DebugCompileResult {
  success: boolean
  debugContent?: string
  md5?: string
  error?: string
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
