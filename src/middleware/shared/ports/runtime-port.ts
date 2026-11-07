import type { PluginCommandOutcome } from '../../../backend/shared/utils/vpp/screen-actions'
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

export type RuntimeConnectFailureKind = 'refused' | 'timeout' | 'host-unreachable' | 'network-unreachable' | 'other'

export interface UsersInfoResult {
  hasUsers: boolean
  runtimeVersion?: string
  error?: string
  failure?: RuntimeConnectFailureKind
}

export type UsersInfoRawFacts =
  | { kind: 'response'; statusCode: number; body: string; runtimeVersion?: string }
  | { kind: 'error'; code?: string; message: string; timedOut: boolean }

/**
 * Result of a {@link RuntimePort.getRuntimeCapabilities} call.
 *
 * `features` carries the EtherDOG hello features array. A runtime that publishes none (an
 * older runtime or EtherDOG) gives an empty array. `null` means the features are unknown: the
 * runtime did not answer, or its EtherDOG is not running; `error` says which.
 */
export interface RuntimeCapabilitiesResult {
  features: readonly string[] | null
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
  /**
   * Name of the source project the device is storing, from the unauthenticated discovery reply, for display only.
   * Absent means the device stores no project.
   */
  projectName?: string
  /** When that project was stored, ISO 8601. Absent alongside `projectName`. */
  projectTimestamp?: string
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

/**
 * A device the retrieve picker can offer, found by a LAN scan on the desktop or through each orchestrator's agent on
 * web.
 */
export interface RetrievableDevice {
  /**
   * Stable identity, defined by whichever platform produced it -- an address on
   * the desktop, orchestrator and device id on web. Compared, never parsed.
   */
  key: string
  /** The device's own name: an address, or a device name under an orchestrator. */
  name: string
  /** Where it lives, when that is a separate fact: an orchestrator's name, a hostname. */
  location?: string
  /** Whether this device answered discovery at all. */
  answeredScan: boolean
  projectName?: string
  projectTimestamp?: string
}

/**
 * A project fetched from a device but not yet opened. `payload` is opaque: a scratch directory on the desktop, archive
 * bytes on web.
 */
export interface FetchedProject {
  projectName: string
  payload: unknown
  libraries?: Array<{ name: string; version: string; status: 'installed' | 'differs' | 'missing' }>
}

/**
 * Result shape shared by every bootloader call. `error` strings come from the
 * bootloader itself and are written to be shown to a person.
 */
export type BootloaderApiResult<T> = { success: true; data: T } | { success: false; error: string }

/**
 * The runtime bootloader: a second service on the device that starts the runtime container, reached through the same
 * agent proxy on its own port. A device without one fails `getCapabilities`.
 */
export type BootloaderCapabilities = {
  service: string
  bootloaderVersion?: string
  runtimeVersion?: string
  state: string
  recovery: boolean
}

export type BootloaderStatus = {
  state: string
  reason?: string
  since?: string
  crashCount?: number
  healthSource?: string
  containerId?: string
  containerName?: string
  image?: string
  runtimeVersion?: string
  recovery?: boolean
}

export type BootloaderLogs = {
  logs: string
  available: boolean
  reason?: string
  tail?: number
}

/**
 * Update progress. `percent` is absent while the daemon has reported no size
 * to work from -- for layers it already holds, and before any size is known --
 * so a UI must treat "no percentage" as indeterminate, never as zero.
 */
export type BootloaderUpdateProgress = {
  state: string
  from?: string
  to?: string
  phase?: string
  percent?: number | null
  error?: string
  startedAt?: string
  finishedAt?: string | null
}

/** Host facts for the Runtime Status header, served by the bootloader from the Docker daemon. */
export type RuntimeDeviceInfo = {
  hostname?: string
  architecture?: string
  kernel?: string
  system?: string
  cpus?: number
  memoryBytes?: number
  dockerVersion?: string
}

export interface BootloaderCapabilitiesOptions {
  timeoutMs?: number
}

export interface BootloaderPort {
  getCapabilities(options?: BootloaderCapabilitiesOptions): Promise<BootloaderApiResult<BootloaderCapabilities>>
  login(username: string, password: string): Promise<BootloaderApiResult<{ role?: string }>>
  getStatus(): Promise<BootloaderApiResult<BootloaderStatus>>
  /** Host facts for the Runtime Status header. Authenticated, like status. */
  getDeviceInfo(): Promise<BootloaderApiResult<RuntimeDeviceInfo>>
  getRuntimeLogs(tail?: number): Promise<BootloaderApiResult<BootloaderLogs>>
  /** Upgrade and downgrade are the same call: no direction, no version floor. */
  startUpdate(version: string): Promise<BootloaderApiResult<BootloaderUpdateProgress>>
  getUpdateProgress(): Promise<BootloaderApiResult<BootloaderUpdateProgress>>
  restartRuntime(): Promise<BootloaderApiResult<{ state?: string; reason?: string }>>
  clearSession(): Promise<void>
}

export interface PluginCommandArgs {
  /**
   * Fetch the EtherDOG features the connected runtime advertises. `features: []` means no EtherCAT features advertised;
   * `features: null` means the runtime could not be reached.
   */
  plugin: string
  command: string
  params?: Record<string, unknown>
  /** Abort and report a failure after this long. */
  timeoutMs?: number
}

export interface RuntimePort {
  /** The bootloader on this device, when one is present. */
  bootloader: BootloaderPort

  /**
   * Invoke a VPP plugin command (`discover`, `test`, `status`) on the connected device through `POST
   * /api/plugin-command`. `ok: false` means the command did not do what was asked. Optional: a platform with no device
   * transport omits it.
   */
  setDeviceContext?(context: { agentId: string; deviceId: string } | null): void

  /** Authenticate with the runtime. Returns JWT on success. */
  login(params: LoginParams): Promise<LoginResult>

  /** Create a new user on the runtime (first-time setup). */
  createUser(params: CreateUserParams): Promise<{ success: boolean; error?: string }>

  /** Check if the runtime has users and get its version. */
  getUsersInfo(): Promise<UsersInfoResult>

  /**
   * Fetch the EtherDOG features the connected runtime advertises.
   * Called after a successful connect so the pre-build capability gate can
   * refuse a project that uses features the runtime does not support.
   * `features: []` means "no EtherCAT features advertised"; `features: null`
   * means the runtime could not be reached at all.
   */
  getRuntimeCapabilities(): Promise<RuntimeCapabilitiesResult>

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

  /**
   * Start the PLC program on the runtime. `status`, when present, carries the raw `status` field of the runtime's
   * response body (e.g. `START:OK`, `ALREADY_RUNNING`, `COMMAND:BUSY`).
   */
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
   * Invoke a VPP plugin command on the connected device — the `discover`,
   * `test` and `status` actions a vendor screen declares.
   *
   * Rides the runtime's existing `POST /api/plugin-command` catch-all with the
   * body it already accepts; no runtime change is involved. That route answers
   * HTTP 200 even for a plugin failure, with the reason in an `error` key, so
   * the outcome here is already interpreted — `ok: false` means the command
   * did not do what was asked, whether the transport or the plugin said so.
   *
   * Optional: a platform with no device transport omits it, and the screen
   * renders its device actions disabled instead of offering a dead button.
   */
  sendPluginCommand?(args: PluginCommandArgs): Promise<PluginCommandOutcome>

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
    snapshot?: { archiveBase64: string; metadata: string },
  ): Promise<{
    success: boolean
    error?: string
    /** Set when the device took the program but refused the project beside it. The upload succeeded. */
    snapshotWarning?: string
  }>

  /**
   * Subscribe to token refresh events (e.g., JWT auto-renewal).
   * Returns unsubscribe function.
   */
  onTokenRefreshed?(callback: (newToken: string) => void): Unsubscribe

  /** Current runtime access token held by the platform's token authority, or null when not authenticated. */
  getAccessToken?(): string | null

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

  /** Username of the live runtime session, for attributing a stored project. */
  getSessionUsername?(): string | null

  /**
   * The devices this platform can offer, already merged with whatever it knows
   * about what they are storing.
   *
   * A platform that discovers progressively can also push rows through
   * `onRetrievableDeviceFound`; this resolves when its sweep is done.
   */
  listRetrievableDevices?(): Promise<
    { success: true; devices: RetrievableDevice[] } | { success: false; error: string }
  >

  /**
   * Rows arriving one at a time, for a platform whose discovery streams. Optional. Subscribe before scanning or the
   * first replies are lost.
   */
  onRetrievableDeviceFound?(callback: (device: RetrievableDevice) => void): Unsubscribe

  /**
   * The device a live session is held for, or '' when there is none, empty until a login has succeeded. Compared
   * against `RetrievableDevice.key`, never parsed.
   */
  connectedRetrievableDeviceKey?(): string

  /** Point this platform at `device` for the calls that follow, before the login. */
  selectRetrievableDevice?(device: RetrievableDevice): void

  /** Fetch the stored project without opening it; `openFetchedProject` opens it. */
  fetchRetrievableProject?(
    device: RetrievableDevice,
  ): Promise<{ success: true; project: FetchedProject } | { success: false; error: string }>

  /** Make a fetched project the open one. */
  openFetchedProject?(project: FetchedProject): Promise<{ success: boolean; error?: string }>

  /** Install libraries a retrieved project brought with it, by name, from the fetched project. */
  installRetrievedLibraries?(
    project: FetchedProject,
    names: string[],
  ): Promise<{ success: boolean; installed: string[]; failed: Array<{ name: string; error: string }> }>
}
