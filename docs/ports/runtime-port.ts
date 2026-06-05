/**
 * RuntimePort — Abstracts communication with a remote OpenPLC runtime device.
 *
 * Editor adapter: Proxies HTTP calls through main process IPC
 *                 (window.bridge.runtimeLogin, runtimeGetStatus, etc.).
 * Web adapter:    Calls runtime-api.ts which routes through orchestrator/agent proxy,
 *                 with WebRTC-first strategy and HTTP fallback.
 *
 * Connection details (IP address, JWT token, agentId, deviceId) are managed
 * internally by each adapter. The UI only passes logical identifiers
 * when needed, and the adapter resolves them to transport-specific params.
 *
 * ## Editor IPC methods replaced:
 *   - window.bridge.runtimeLogin()
 *   - window.bridge.runtimeCreateUser()
 *   - window.bridge.runtimeGetUsersInfo()
 *   - window.bridge.runtimeGetStatus()
 *   - window.bridge.runtimeStartPlc()
 *   - window.bridge.runtimeStopPlc()
 *   - window.bridge.runtimeGetLogs()
 *   - window.bridge.runtimeGetSerialPorts()
 *   - window.bridge.runtimeGetCompilationStatus()
 *   - window.bridge.runtimeClearCredentials()
 *   - window.bridge.onRuntimeTokenRefreshed()
 *
 * ## Web service methods replaced:
 *   - runtimeLogin()
 *   - runtimeCreateUser()
 *   - runtimeGetUsersInfo()
 *   - runtimeGetStatus()
 *   - runtimeStartPlc()
 *   - runtimeStopPlc()
 *   - runtimeGetLogs()
 *   - runtimeGetSerialPorts()
 *   - runtimeGetCompilationStatus()
 *   - runtimeUploadProgram()
 *   - runtimeLogout()
 */

import type {
  PlcStatus,
  RuntimeLogEntry,
  SerialPort,
  TimingStats,
  Unsubscribe,
} from './types'

export interface LoginParams {
  username: string
  password: string
}

export interface LoginResult {
  success: boolean
  accessToken?: string
  error?: string
}

export interface CreateUserParams {
  username: string
  password: string
}

export interface UsersInfoResult {
  hasUsers: boolean
  runtimeVersion?: string
  error?: string
}

export interface RuntimeStatusResult {
  success: boolean
  status?: PlcStatus | string
  timingStats?: TimingStats
  error?: string
}

export interface CompilationStatusResult {
  success: boolean
  data?: {
    status: string
    logs: string[]
    exit_code: number | null
  }
  error?: string
}

export interface RuntimeLogsResult {
  success: boolean
  logs?: string | RuntimeLogEntry[]
  error?: string
}

export interface RuntimePort {
  /** Authenticate with the runtime. Returns JWT on success. */
  login(params: LoginParams): Promise<LoginResult>

  /** Create a new user on the runtime (first-time setup). */
  createUser(params: CreateUserParams): Promise<{ success: boolean; error?: string }>

  /** Check if the runtime has users and get its version. */
  getUsersInfo(): Promise<UsersInfoResult>

  /** Get current PLC runtime status with optional timing statistics. */
  getStatus(includeStats?: boolean): Promise<RuntimeStatusResult>

  /** Start the PLC program on the runtime. */
  startPlc(): Promise<{ success: boolean; error?: string }>

  /** Stop the PLC program on the runtime. */
  stopPlc(): Promise<{ success: boolean; error?: string }>

  /** Get runtime logs, optionally filtered by minimum log ID. */
  getLogs(minId?: number): Promise<RuntimeLogsResult>

  /** Get serial ports available on the runtime device. */
  getSerialPorts(): Promise<{ success: boolean; ports?: SerialPort[]; error?: string }>

  /** Get the status of an ongoing compilation on the runtime. */
  getCompilationStatus(): Promise<CompilationStatusResult>

  /** Clear stored credentials (logout). */
  clearCredentials(): Promise<{ success: boolean }>

  /**
   * Upload a compiled program to the runtime.
   * Web adapter: sends zip as base64.
   * Editor adapter: sends via file path or streamed content.
   */
  uploadProgram?(programData: string | ArrayBuffer): Promise<{ success: boolean; error?: string }>

  /**
   * Subscribe to token refresh events (e.g., JWT auto-renewal).
   * Returns unsubscribe function.
   */
  onTokenRefreshed?(callback: (newToken: string) => void): Unsubscribe
}
