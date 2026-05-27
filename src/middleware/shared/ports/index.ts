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
 * 12 Port Interfaces:
 *   1. CompilerPort      — PLC compilation pipeline
 *   2. RuntimePort       — Remote PLC runtime communication
 *   3. DebuggerPort      — Debug protocol (variable read/write)
 *   4. SimulatorPort     — Built-in AVR simulator
 *   5. ProjectPort       — Project lifecycle (create, open, save, POU management)
 *   6. DevicePort        — Board/hardware discovery
 *   7. OrchestratorPort  — Orchestrator discovery and device listing
 *   8. SystemPort        — Platform services (store, links, logging)
 *   9. WindowPort        — Native window management
 *  10. AcceleratorPort   — Keyboard shortcuts
 *  11. ThemePort         — Theme detection and switching
 *  12. AIPort            — AI-assisted coding (completions, chat, credits, telemetry)
 *
 * Plus:
 *   - PlatformCapabilities — Feature toggle flags
 *   - Shared domain types  — PLCVariable, BoardInfo, TimingStats, etc.
 */

// --- Port interfaces ---
export type { AcceleratorPort } from './accelerator-port'
export type {
  AIChatLanguage,
  AIChatParams,
  AICompleteParams,
  AICompletionLanguage,
  AICreditStatus,
  AIPort,
  AITelemetryEventName,
} from './ai-port'
export type { CompilerPort } from './compiler-port'
export type { DebuggerPort } from './debugger-port'
export type { DevicePort } from './device-port'
export type { NavigationPort, NavigationSearch } from './navigation-port'
export { buildNavigationUrl } from './navigation-port'
export type { OrchestratorPort } from './orchestrator-port'
export type { ProjectPort } from './project-port'
export type { RuntimePort } from './runtime-port'
export type { SimulatorPort } from './simulator-port'
export type { StlibSource, StlibSourcePort } from './stlib-source-port'
export type { SystemPort } from './system-port'
export type { ThemePort } from './theme-port'
export type { VersionControlPort } from './version-control-port'
export type { WindowPort } from './window-port'

// --- Feature toggles ---
export type { PlatformCapabilities } from './platform-capabilities'
export { EDITOR_CAPABILITIES, WEB_CAPABILITIES } from './platform-capabilities'

// --- Shared domain types ---
export type {
  Architecture,
  BoardInfo,
  CommunicationPort,
  // Compiler
  CompileProgressEvent,
  CompileResult,
  // Device
  CompilerType,
  DebugCompileResult,
  DebugSetResult,
  DebugTreeNode,
  // Debugger
  DebugVariableResult,
  DeviceConfiguration,
  DevicePin,
  // Debugger session
  FbInstanceInfo,
  // Console
  LogObject,
  Md5VerifyResult,
  PinType,
  // System
  Platform,
  PLCBody,
  PLCDataType,
  PLCExtendedLanguage,
  PLCInstance,
  // PLC
  PLCLanguage,
  PlcLogs,
  PLCPou,
  PLCProjectData,
  // Runtime
  PlcStatus,
  PLCTask,
  PLCVariable,
  PLCVariableType,
  PouType,
  ProjectMeta,
  RecentProject,
  // Result wrappers
  Result,
  RuntimeLogEntry,
  RuntimeLogLevel,
  SerialPort,
  // Simulator Debug
  SimulatorDebugResult,
  SystemInfo,
  TimingStats,
  Unsubscribe,
  VariableClass,
} from './types'

// --- Runtime log helpers ---
export { isV4Logs } from './types'

// --- PLC type system Zod schemas ---
export {
  BaseLibraryPouSchema,
  BaseLibraryVariableSchema,
  baseTypeEnum,
  baseTypeSchema,
  genericTypeSchema,
} from './plc-schemas'

// --- Port parameter/result types ---
export type { CompileProgramArgs, DebugCompileArgs, ExportXmlArgs } from './compiler-port'
export type { OrchestratorDevice, OrchestratorInfo } from './orchestrator-port'
export type {
  CreatePouParams,
  CreateProjectParams,
  ProjectResponse,
  RenamePouParams,
  WriteProjectFiles,
} from './project-port'
export type {
  CompilationStatusResult,
  CreateUserParams,
  DiscoverDevicesOptions,
  DiscoverDevicesResult,
  DiscoveredRuntimeDevice,
  LoginParams,
  LoginResult,
  RuntimeLogsResult,
  RuntimeStatusResult,
  UsersInfoResult,
} from './runtime-port'
export type { ThemeVariant } from './theme-port'
export type {
  Branch,
  Commit,
  CommitFile,
  CommitInfo,
  DiffStatus,
  FlowData,
  GraphicalDiffResult,
  ListCommitsOptions,
  ParsedVariable,
  PendingChange,
  VarDiffEntry,
} from './version-control-port'
