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

/**
 * RBAC role for a runtime account. `admin` may manage every account;
 * `user` may edit only its own account and cannot create/delete users.
 */
export type RuntimeUserRole = 'admin' | 'user'

export interface CreateUserParams {
  username: string
  password: string
  /** Role for the new account. Ignored for the unauthenticated first-user
   *  bootstrap (the runtime always makes the first user an admin). */
  role?: RuntimeUserRole
}

export interface UsersInfoResult {
  hasUsers: boolean
  runtimeVersion?: string
  error?: string
}

/** A user account as reported by the runtime. */
export interface RuntimeUser {
  id: number
  username: string
  role: RuntimeUserRole
}

export interface ListUsersResult {
  success: boolean
  users?: RuntimeUser[]
  error?: string
}

export interface WhoAmIResult {
  success: boolean
  user?: RuntimeUser
  error?: string
}

/**
 * Fields to change on an existing account. Only the provided fields are
 * applied. `currentPassword` is required by the runtime when changing your
 * OWN password (not when an admin resets another user's password).
 */
export interface UpdateUserParams {
  username?: string
  password?: string
  currentPassword?: string
  role?: RuntimeUserRole
}

export interface RuntimeStatusResult {
  success: boolean
  status?: PlcStatus | (string & {})
  timingStats?: TimingStats
  /** Run/stop mode-switch position reported by the runtime (`'run'` /
   *  `'stop'`).  Devices with no switch-aware VPP plugin always report
   *  `'run'`, and runtimes older than this field omit it entirely — treat
   *  `undefined` as "no gating". */
  switchPosition?: 'run' | 'stop'
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
  /** Name of the source project the device is storing, when it has one.
   *
   *  Carried on the unauthenticated discovery reply so the retrieve picker can
   *  be populated without logging in to every device on the network. Display
   *  only: it is whatever the uploading client said, the device never opened
   *  the archive to check, and the authoritative name comes from the archive
   *  itself once retrieved. Absent means the device stores no project. */
  projectName?: string
  /** When that project was stored, ISO 8601. Absent alongside `projectName`. */
  projectTimestamp?: string
}

/** What a device reports about the project it stores, once authenticated. */
export interface RuntimeProjectSnapshotInfo {
  present: boolean
  projectName?: string
  editorVersion?: string
  uploadedBy?: string
  timestamp?: string
  sizeBytes?: number
  formatVersion?: number
  libraries?: Array<{ name: string; version?: string; hash?: string }>
}

/** The manifest carried inside a retrieved archive. */
export interface RuntimeProjectSnapshotMetadata {
  formatVersion: number
  projectName: string
  editorVersion: string
  uploadedBy: string
  timestamp: string
  libraries: Array<{ name: string; version: string; hash: string }>
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

  /** List all user accounts on the runtime (requires authentication). */
  listUsers(): Promise<ListUsersResult>

  /** Return the currently authenticated account (id, username, role). */
  whoAmI(): Promise<WhoAmIResult>

  /** Update an account's username, password and/or role. */
  updateUser(userId: number, params: UpdateUserParams): Promise<{ success: boolean; error?: string }>

  /** Delete an account by id (admin only; cannot delete your own account). */
  deleteUser(userId: number): Promise<{ success: boolean; error?: string }>

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
  uploadProgram?(
    programData: string | ArrayBuffer,
    /** The source project to store on the device alongside the program, so it
     *  can be retrieved later. Optional: a runtime without snapshot support
     *  ignores it, and an upload is complete without one. */
    snapshot?: { archiveBase64: string; metadata: string },
  ): Promise<{ success: boolean; error?: string }>

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

  // --- stored source project ---

  /**
   * What a device says about the source project it stores.
   *
   * Authenticated but not admin-gated on the device, so the UI can decide
   * whether to offer retrieval without holding the privilege retrieval needs.
   */
  getProjectSnapshotInfo?(
    /** Desktop passes the device address; web resolves it from its device context. */
    ipAddress?: string,
  ): Promise<{ success: boolean; info?: RuntimeProjectSnapshotInfo; error?: string }>

  /**
   * Retrieve the stored project and unpack it somewhere the editor can open it.
   *
   * Desktop only, and it returns a path rather than the archive on purpose:
   * those are untrusted bytes from a device, and every check deciding whether
   * they are safe to WRITE belongs beside the write, in the main process,
   * rather than in the renderer.
   *
   * Web implements `retrieveProjectArchive` instead. The split is real rather
   * than cosmetic: web has no filesystem to unpack onto and imports the project
   * into its workspace, so forcing both onto one shape would mean one of them
   * returning a path that does not exist.
   */
  retrieveProject?(ipAddress: string): Promise<{
    success: boolean
    projectPath?: string
    projectName?: string
    metadata?: RuntimeProjectSnapshotMetadata
    libraries?: Array<{ name: string; version: string; status: 'installed' | 'differs' | 'missing' }>
    error?: string
  }>

  /** Username of the live runtime session, for attributing a stored project to
   *  whoever uploaded it. Only the username -- the password stays inside the
   *  token authority. */
  getSessionUsername?(): string | null

  /** The device this session is authenticated against, or null when there is no
   *  session. A device context alone is not one: selecting a device points the
   *  adapter at it without signing in, so both have to hold before a caller may
   *  skip asking for credentials. */
  getAuthenticatedDevice?(): { agentId: string; deviceId: string } | null

  /**
   * Retrieve the stored project as raw archive bytes.
   *
   * Web's counterpart to `retrieveProject`: there is no filesystem to unpack
   * onto, so the archive is parsed in the browser and imported into the
   * workspace. The bytes are still untrusted -- the shared parser validates
   * before yielding any of them.
   */
  retrieveProjectArchive?(): Promise<
    { success: true; archive: Uint8Array; projectName: string } | { success: false; error: string }
  >

  /** Install libraries a retrieved project brought with it, by name. */
  installRetrievedLibraries?(
    projectPath: string,
    names: string[],
  ): Promise<{ success: boolean; installed: string[]; failed: Array<{ name: string; error: string }> }>
}
