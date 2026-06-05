/**
 * Port Interfaces — Contracts that decouple the shared UI from platform-specific implementations.
 *
 * Architecture:
 *
 *   Shared UI (React components, hooks, store)
 *       │
 *       │ depends on
 *       ▼
 *   Port Interfaces (this package)
 *       │
 *       │ implemented by
 *       ▼
 *   ┌─────────────────┬──────────────────┐
 *   │ Editor Adapters  │  Web Adapters    │
 *   │ (Electron IPC)   │  (HTTP/WebRTC)   │
 *   └─────────────────┴──────────────────┘
 *
 * Usage:
 *   The PlatformProvider React context (see platform-provider.ts) supplies
 *   concrete port implementations to the component tree. Components access
 *   ports via usePlatform() hook:
 *
 *     const { compiler, runtime, debugger } = usePlatform()
 *     await compiler.compileProgram(args, onProgress)
 *
 * 10 Port Interfaces:
 *   1. CompilerPort    — PLC compilation pipeline
 *   2. RuntimePort     — Remote PLC runtime communication
 *   3. DebuggerPort    — Debug protocol (variable read/write)
 *   4. SimulatorPort   — Built-in AVR simulator
 *   5. ProjectPort     — Project lifecycle (create, open, save, POU management)
 *   6. DevicePort      — Board/hardware discovery
 *   7. SystemPort      — Platform services (store, links, logging)
 *   8. WindowPort      — Native window management
 *   9. AcceleratorPort — Keyboard shortcuts
 *  10. ThemePort       — Theme detection and switching
 *
 * Plus:
 *   - PlatformCapabilities — Feature toggle flags
 *   - Shared domain types  — PLCVariable, BoardInfo, TimingStats, etc.
 */

// --- Port interfaces ---
export type { CompilerPort } from './compiler-port'
export type { RuntimePort } from './runtime-port'
export type { DebuggerPort } from './debugger-port'
export type { SimulatorPort } from './simulator-port'
export type { ProjectPort } from './project-port'
export type { DevicePort } from './device-port'
export type { SystemPort } from './system-port'
export type { WindowPort } from './window-port'
export type { AcceleratorPort } from './accelerator-port'
export type { ThemePort } from './theme-port'

// --- Feature toggles ---
export type { PlatformCapabilities } from './platform-capabilities'
export { EDITOR_CAPABILITIES, WEB_CAPABILITIES } from './platform-capabilities'

// --- Shared domain types ---
export type {
  // Result wrappers
  Result,
  Unsubscribe,
  // PLC
  PLCLanguage,
  PLCExtendedLanguage,
  PouType,
  VariableClass,
  PLCVariable,
  PLCVariableType,
  PLCTask,
  PLCInstance,
  PLCDataType,
  PLCBody,
  PLCPou,
  PLCProjectData,
  ProjectMeta,
  // Device
  CompilerType,
  BoardInfo,
  CommunicationPort,
  SerialPort,
  PinType,
  DevicePin,
  DeviceConfiguration,
  ModbusRTUConfig,
  ModbusTCPConfig,
  // Runtime
  PlcStatus,
  TimingStats,
  RuntimeLogLevel,
  RuntimeLogEntry,
  // Debugger
  DebugVariableResult,
  DebugSetResult,
  Md5VerifyResult,
  // Compiler
  CompileProgressEvent,
  CompileResult,
  DebugCompileResult,
  // Console
  LogObject,
  // System
  Platform,
  Architecture,
  SystemInfo,
  RecentProject,
} from './types'

// --- Port parameter/result types ---
export type { CompileProgramArgs, DebugCompileArgs, ExportXmlArgs } from './compiler-port'
export type {
  LoginParams,
  LoginResult,
  CreateUserParams,
  UsersInfoResult,
  RuntimeStatusResult,
  CompilationStatusResult,
  RuntimeLogsResult,
} from './runtime-port'
export type {
  CreateProjectParams,
  ProjectResponse,
  SaveProjectParams,
  CreatePouParams,
  RenamePouParams,
} from './project-port'
export type { ThemeVariant } from './theme-port'
