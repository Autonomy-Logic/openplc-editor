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
  EtherCATRuntimeStatusResponse,
  EtherCATScanRequest,
  EtherCATScanResponse,
  EtherCATServiceStatusResponse,
  EtherCATTestRequest,
  EtherCATTestResponse,
  EtherCATValidateRequest,
  EtherCATValidateResponse,
  NetworkInterface,
} from './ethercat-types'
import type { PlcStatus, RuntimeLogEntry, SerialPort, TimingStats, Unsubscribe } from './types'

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
  status?: PlcStatus | (string & {})
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

/**
 * A runtime device discovered on the LAN via UDP broadcast.
 *
 * `ipAddress` is the reachable address learned from the response
 * packet's source IP — that's authoritative even when the runtime
 * has multiple interfaces and doesn't know its outward-facing one.
 */
export interface DiscoveredRuntimeDevice {
  ipAddress: string
  hostname: string
  runtimeVersion: string
  apiPort: number
}

export interface DiscoverDevicesOptions {
  /** How long to listen for replies after sending the probe. */
  durationMs?: number
}

export interface DiscoverDevicesResult {
  success: boolean
  devices?: DiscoveredRuntimeDevice[]
  error?: string
}

export interface RuntimePort {
  /** Set the target device for subsequent API calls. */
  setDeviceContext?(context: { agentId: string; deviceId: string } | null): void

  /** Authenticate with the runtime. Returns JWT on success. */
  login(params: LoginParams): Promise<LoginResult>

  /** Create a new user on the runtime (first-time setup). */
  createUser(params: CreateUserParams): Promise<{ success: boolean; error?: string }>

  /** Check if the runtime has users and get its version. */
  getUsersInfo(): Promise<UsersInfoResult>

  /** Get current PLC runtime status with optional timing statistics. */
  getStatus(includeStats?: boolean): Promise<RuntimeStatusResult>

  /** Start the PLC program on the runtime.  `status`, when present,
   *  carries the raw `status` field of the runtime's response body
   *  (e.g. `START:OK`, `ALREADY_RUNNING`, `COMMAND:BUSY`).  Callers
   *  building a retry loop around the runtime's post-upload BUSY
   *  window need that string — see
   *  `backend/shared/library/start-plc-after-build.ts`. */
  startPlc(): Promise<{ success: boolean; error?: string; status?: string }>

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
   * Check if the runtime connection is ready for debug operations.
   * Each adapter implements its own readiness criteria:
   *   - Web: device context set and authenticated (orchestrator connection)
   *   - Editor: runtime IP address configured and authenticated
   */
  isReadyForDebug?(): boolean

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

  /**
   * Current runtime access token held by the platform's token authority, or
   * null when not authenticated. Exposed so non-RuntimePort callers (e.g. the
   * compile/upload pipeline) can read the always-fresh token from the single
   * authority instead of a separately-tracked copy.
   */
  getAccessToken?(): string | null

  // --- LAN discovery (UDP broadcast) ---

  /**
   * Probe the local network for OpenPLC runtime devices.  Resolves
   * with the full set after the listen window closes.  Use
   * `onDeviceDiscovered` for live updates while the scan is in flight.
   */
  discoverDevices?(opts?: DiscoverDevicesOptions): Promise<DiscoverDevicesResult>

  /**
   * Subscribe to live device-discovered notifications.  Fires once
   * per unique source IP during a `discoverDevices` call.
   */
  onDeviceDiscovered?(callback: (device: DiscoveredRuntimeDevice) => void): Unsubscribe

  // --- EtherCAT Discovery (runtime device commands) ---

  /** Get network interfaces available on the runtime device. */
  getNetworkInterfaces?(): Promise<{ success: boolean; data?: NetworkInterface[]; error?: string }>

  /** Check if the EtherCAT service is available on the runtime. */
  getEthercatServiceStatus?(): Promise<{ success: boolean; data?: EtherCATServiceStatusResponse; error?: string }>

  /** Scan for EtherCAT devices on a network interface. */
  scanEthercatDevices?(
    request: EtherCATScanRequest,
  ): Promise<{ success: boolean; data?: EtherCATScanResponse; error?: string }>

  /** Test connection to a specific EtherCAT slave. */
  testEthercatConnection?(
    request: EtherCATTestRequest,
  ): Promise<{ success: boolean; data?: EtherCATTestResponse; error?: string }>

  /** Validate an EtherCAT configuration against the runtime. */
  validateEthercatConfig?(
    request: EtherCATValidateRequest,
  ): Promise<{ success: boolean; data?: EtherCATValidateResponse; error?: string }>

  /** Get EtherCAT runtime status (plugin state, slave status, cycle metrics). */
  getEthercatRuntimeStatus?(): Promise<{ success: boolean; data?: EtherCATRuntimeStatusResponse; error?: string }>
}
