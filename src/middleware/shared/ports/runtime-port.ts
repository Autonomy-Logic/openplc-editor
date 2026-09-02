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

/**
 * Persistent-storage (RETAIN) settings for the runtime's BUILT-IN file store,
 * plus what is actually holding retained bytes right now.
 *
 * The two are separate on purpose. A VPP plugin that provides its own retain
 * backend OVERRIDES the built-in store, so a device can have `enabled: true`
 * and a `backend` of `'plugin'` at the same time — the file settings are saved
 * and simply not in use. A screen that showed only `enabled` would tell the
 * operator retention is going to a file that will never grow.
 */
export interface RetainConfig {
  /** Whether the runtime's built-in file store is switched on. */
  enabled: boolean
  /** Absolute path the built-in store writes to. */
  path: string
  /** How often the store commits to disk. Bounds how much retained state a
   *  power cut costs, against how hard the storage is worked. */
  flushSeconds: number
  /** Defaults and bounds the runtime will accept, so the UI does not have to
   *  hard-code a copy of them and drift. */
  defaultPath: string
  defaultFlushSeconds: number
  minFlushSeconds: number
  maxFlushSeconds: number
  /** What is holding retained bytes NOW: `'plugin'` (a VPP took over),
   *  `'file'` (the built-in store), `'none'`, or `'unknown'` when the core
   *  could not be reached. */
  backend: 'none' | 'plugin' | 'file' | 'unknown' | (string & {})
  /** The plugin's name, or the file path — whichever `backend` names. */
  backendDetail: string
  /** Whether the loaded program actually has retention running. False when the
   *  program retains nothing, or no storage is configured. */
  active: boolean
}

export interface RetainConfigResult {
  success: boolean
  config?: RetainConfig
  error?: string
}

/** Fields to change. Only the provided ones are applied. */
export interface UpdateRetainConfigParams {
  enabled?: boolean
  path?: string
  flushSeconds?: number
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
 * A device the retrieve picker can offer, however the platform found it.
 *
 * The desktop finds these by scanning its LAN; web asks each orchestrator's
 * agent. Both end up describing the same thing, which is why the picker does
 * not need to know which happened.
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
  /**
   * Whether this device answered discovery at all.
   *
   * The distinction the picker depends on: a device that answered and named no
   * project genuinely stores none, while one that never answered has said
   * nothing. Only the first may be greyed out.
   */
  answeredScan: boolean
  projectName?: string
  projectTimestamp?: string
}

/**
 * A project fetched from a device but not yet opened.
 *
 * `payload` is deliberately opaque: a scratch directory on the desktop, archive
 * bytes on web. It goes back to the same platform that produced it and nothing
 * in between looks inside.
 */
export interface FetchedProject {
  projectName: string
  payload: unknown
  libraries?: Array<{ name: string; version: string; status: 'installed' | 'differs' | 'missing' }>
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

  /** Read the persistent-storage settings and the live retain backend.
   *  Runtimes older than 4.2.0 have no such endpoint — gate on
   *  `isRetainConfigCapableRuntime` before calling. */
  getRetainConfig(): Promise<RetainConfigResult>

  /** Update the persistent-storage settings (admin only). Takes effect when
   *  the PLC next starts: the core reads them once per program load. */
  updateRetainConfig(params: UpdateRetainConfigParams): Promise<RetainConfigResult>

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
  ): Promise<{
    success: boolean
    error?: string
    /** Set when the device took the program but refused the project beside it.
     *  The upload succeeded; the caller should say so in the build log, because
     *  the alternative is a device that silently cannot be retrieved from. */
    snapshotWarning?: string
  }>

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

  // --- Retrieve Project from PLC ---------------------------------------
  //
  // These exist so the picker itself can be one shared component. What differs
  // between the two platforms is not the flow -- pick a device, get a session,
  // fetch, open -- but where the devices come from and what "open" means: the
  // desktop scans a LAN and unpacks to a scratch directory, web asks an
  // orchestrator and parses into the workspace. Those are the only differences,
  // so those are the only things behind the port.

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
   * Rows arriving one at a time, for a platform whose discovery streams.
   *
   * Optional: a platform that can only answer all at once simply does not
   * implement it, and the picker fills in when `listRetrievableDevices`
   * resolves. Subscribe before scanning or the first replies are lost.
   */
  onRetrievableDeviceFound?(callback: (device: RetrievableDevice) => void): Unsubscribe

  /**
   * The device a live session is held for, or '' when there is none.
   *
   * A device context alone is not a session: pointing the adapter at a device
   * does not sign in, so this must stay empty until a login has succeeded.
   * Compared against `RetrievableDevice.key`, never parsed.
   */
  connectedRetrievableDeviceKey?(): string

  /**
   * Point this platform at `device` for the calls that follow.
   *
   * Separate from fetching because the desktop's adapter reads its target from
   * the store before authenticating, so the target has to move before the
   * login, not with it.
   */
  selectRetrievableDevice?(device: RetrievableDevice): void

  /**
   * Fetch the stored project, without opening it.
   *
   * Split from `openFetchedProject` so the shared picker can run the
   * unsaved-changes prompt in between -- after the fetch has succeeded, so a
   * device that turns out to have nothing does not cost the user their project,
   * and before anything is replaced.
   */
  fetchRetrievableProject?(
    device: RetrievableDevice,
  ): Promise<{ success: true; project: FetchedProject } | { success: false; error: string }>

  /** Make a fetched project the open one. */
  openFetchedProject?(project: FetchedProject): Promise<{ success: boolean; error?: string }>

  /**
   * Open a retrieved archive as the workspace's project.
   *
   * The sibling of `retrieveProjectArchive`, and the reason both exist as port
   * methods rather than as a direct call: the picker is a shared component, and
   * how an archive becomes an open project is exactly the part that differs per
   * platform -- web parses it into the workspace, desktop unpacks it to a
   * scratch directory first. Reaching into a platform's adapter from the
   * component would tie the shared picker to one of them.
   *
   * Throws on a bad archive, so the caller can report it without replacing the
   * workspace: the parser validates everything before yielding a single file.
   */
  importRetrievedProject?(archive: Uint8Array): Promise<{ projectName: string }>

  /**
   * Install libraries a retrieved project brought with it, by name.
   *
   * Takes the fetched project rather than a path so the shared picker does not
   * have to know that one platform has a filesystem and the other does not.
   */
  installRetrievedLibraries?(
    project: FetchedProject,
    names: string[],
  ): Promise<{ success: boolean; installed: string[]; failed: Array<{ name: string; error: string }> }>
}
