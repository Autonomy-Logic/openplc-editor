import {
  fetchPlanCaption as fetchEdgePlanCaption,
  fetchUser as fetchEdgeUser,
  isEncryptionAvailable,
  signIn as signInToEdge,
  signOut as signOutOfEdge,
} from '@root/backend/editor/edge-account/edge-account-service'
import {
  type AiStreamHandle,
  type AiStreamSink,
  createConversation,
  deleteConversation,
  type EdgeAiResult,
  fetchAiCredits,
  fetchAiEntitlements,
  fetchAiUsage,
  getConversation,
  listConversations,
  renameConversation,
  sendAiTelemetry,
  streamAiChat,
  streamAiCompletion,
  warmAi,
} from '@root/backend/editor/edge-ai'
import { closeEditSession, heartbeatEditSession, openEditSession } from '@root/backend/editor/edge-edit-sessions'
import { listCloudFolders, uploadProjectToCloud } from '@root/backend/editor/edge-project-upload'
import {
  listCloudProjectsInFolder,
  listRecentCloudProjects,
  readCloudProject,
  saveCloudFile,
  saveCloudProject,
} from '@root/backend/editor/edge-projects'
import {
  applyStash,
  createBranch,
  createCommit,
  createStash,
  deleteBranch,
  discardChanges,
  dropStash,
  getBranchDiffWithBase,
  getChanges,
  getCommitFiles,
  listBranches,
  listCommits,
  listStashes,
  mergeBranches,
  popStash,
  previewSwitchCarry,
  restoreCommit,
  switchBranch,
} from '@root/backend/editor/edge-version-control'
import { EsiProjectFiles } from '@root/backend/editor/ethercat'
import { createDesktopCatalogTransport } from '@root/backend/editor/library-manager/desktop-catalog-transport'
import { resolveBuildWorkspace } from '@root/backend/editor/project/cloud-build-workspace'
import { describeRetrievedLibraries } from '@root/backend/editor/project/describe-retrieved-libraries'
import {
  materializeRetrievedProject,
  pruneRetrievedProjects,
  RETAINED_RETRIEVALS,
} from '@root/backend/editor/project/materialize-retrieved-project'
import { isWebUrl } from '@root/backend/editor/utils/is-web-url'
import type {
  DebugAnchorResult,
  DebugDeviceIdResult,
  DebugStatusResult,
  DeviceDebugChannel,
  DeviceModbusTransport,
  PlcControlResult,
} from '@root/backend/shared/debug/types'
import { runEsiParseOp } from '@root/backend/shared/ethercat/esi-parse-ops'
import { listPublicLibraries, PublicLibrarySchema } from '@root/backend/shared/library/public-catalog-client'
import type { SnapshotMetadata } from '@root/backend/shared/project/project-snapshot-archive'
import { PlcRuntimeState } from '@root/backend/shared/simulator/types'
import { PLCProjectData } from '@root/backend/shared/types/PLC/open-plc'
import { canonicalWatchKey, FileWatchRegistry } from '@root/backend/shared/utils/file-watch/registry'
import { getErrorMessage } from '@root/frontend/utils/get-error-message'
import type { CompileProgramIpcArgs } from '@root/middleware/adapters/editor/compile-program-flow'
import type { CompileLibraryIpcArgs } from '@root/middleware/adapters/editor/compiler-adapter'
import { RuntimeLogEntry } from '@root/middleware/shared/ports'
import type { AITelemetryEventName } from '@root/middleware/shared/ports/ai-port'
import type { DeviceLicenseReport, DeviceLicenseRequest } from '@root/middleware/shared/ports/device-port'
import type { EdgeSignInOutcome, EdgeUserRead } from '@root/middleware/shared/ports/edge-account-port'
import type { EditSessionBeat, EditSessionOpened } from '@root/middleware/shared/ports/edit-session-port'
import type { EsiParseOp } from '@root/middleware/shared/ports/esi-repository-mechanisms'
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
} from '@root/middleware/shared/ports/ethercat-types'
import type {
  CloudFoldersResult,
  CloudProjectsResult,
  RawProjectFiles,
  UploadProjectResult,
} from '@root/middleware/shared/ports/project-port'
import { WriteProjectFilesSchema } from '@root/middleware/shared/ports/project-port'
import type {
  ListPublicLibrariesArgs,
  ListPublicLibrariesResponse,
  PublicLibrary,
} from '@root/middleware/shared/ports/public-catalog-types'
import type {
  RuntimeCapabilitiesResult,
  RuntimeUser,
  RuntimeUserRole,
  UpdateUserParams,
} from '@root/middleware/shared/ports/runtime-port'
import type { DebugConnectionConfig, PackageInstallProgress } from '@root/middleware/shared/ports/types'
import type { VersionControlResult } from '@root/middleware/shared/ports/version-control-port'
import { capabilitiesFromResponse } from '@root/middleware/shared/utils/build-gate/runtime-capabilities-response'
import { CreatePouFileProps } from '@root/types/IPC/pou-service'
import { CreateProjectFileProps } from '@root/types/IPC/project-service'
import { randomUUID } from 'crypto'
import type { IpcMainEvent, IpcMainInvokeEvent, MessagePortMain, WebContents } from 'electron'
import { app, dialog, nativeTheme, shell } from 'electron'
import { readFile, realpathSync, stat, statSync, unwatchFile, watchFile } from 'fs'
import { unlink, writeFile } from 'fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'path'
import { platform } from 'process'
import { z } from 'zod'

import { MainIpcModule, MainIpcModuleConstructor } from '../../../backend/editor/contracts/types/modules/ipc/main'
import { toDebugCandidate, toDeviceLinkCandidates } from '../../../backend/editor/hardware/debug-channel-factory'
import {
  classifyDeviceLink,
  type DeviceProbeOutcome,
  PATIENT_DEVICE_ID_PROBE,
  QUICK_DEVICE_ID_PROBE,
  SPECULATIVE_DEVICE_ID_PROBE,
} from '../../../backend/editor/hardware/device-probe'
import {
  describeLinkCandidate,
  type DeviceDebugCandidate,
  type DeviceLinkCandidate,
  type DeviceLinkStatus,
  DeviceSessionManager,
} from '../../../backend/editor/hardware/device-session-manager'
import { type DiscoveredRuntime, discoverRuntimes } from '../../../backend/editor/hardware/discover-runtimes'
import { LibraryManagerModule } from '../../../backend/editor/library-manager'
import {
  type DeviceIdentity,
  inspectDeviceLicense,
  type LicenseReadWritable,
  resolveDeviceLicense,
} from '../../../backend/editor/license/license-flow'
import { PackageManagerModule } from '../../../backend/editor/package-manager'
import type { StartupDependencyCheck } from '../../../backend/editor/package-manager/startup-dependency-check'
import {
  createArduinoDependencyServices,
  type VppDependencyService,
} from '../../../backend/editor/package-manager/vpp-dependency-service'
import { BootloaderApiClient, capabilitiesTimeoutMs } from '../../../backend/editor/runtime/bootloader-api-client'
import { RuntimeApiClient } from '../../../backend/editor/runtime/runtime-api-client'
import { logger } from '../../../backend/editor/services'
import {
  getOpenProjectPath,
  getPdfExportSavePath,
  getPlcopenExportSavePath,
  getPlcopenImportFilePath,
  getProjectPath,
} from '../../../backend/editor/utils'
import { getDesktopWasmCompileService } from '../../../backend/editor/wasm-toolchain/desktop-wasm-toolchain'
import { SimulatorModule } from '../../../backend/shared/simulator/simulator-module'
import { VirtualSerialPort } from '../../../backend/shared/simulator/virtual-serial-port'
import {
  interpretPluginCommandResponse,
  PLUGIN_COMMAND_TIMEOUT_MS,
  type PluginCommandOutcome,
} from '../../../backend/shared/utils/vpp/screen-actions'
import type { WasmCompileResult } from '../../../middleware/shared/ports/wasm-toolchain-types'
import { describeDebugEndpoint } from '../../../middleware/shared/utils/debug-endpoint'

const EditSessionClientSchema = z.object({
  kind: z.literal('desktop'),
  label: z.string().trim().min(1).max(120),
})

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0

/** Why a channel could not be handed out. */
interface ChannelUnavailable {
  error: string
  needsReconnect: true
}

/** The identity read is either `getDeviceId` (baremetal) or `getAnchor` (runtime-v4), never both. */
type LicenseChannel = LicenseReadWritable &
  (
    | { getDeviceId(): Promise<DebugDeviceIdResult>; getAnchor?: never }
    | { getAnchor(): Promise<DebugAnchorResult>; getDeviceId?: never }
  )

/** Whether a debug channel can carry the licensing flow: the two licence FCs plus one of the two identity reads. */
function isLicenseChannel(client: DeviceDebugChannel): client is DeviceDebugChannel & LicenseChannel {
  return (
    (typeof client.getDeviceId === 'function' || typeof client.getAnchor === 'function') &&
    typeof client.readLicense === 'function' &&
    typeof client.writeLicense === 'function'
  )
}

/** Turns a failed identity read into a `check-failed` outcome. */
function checkFailedOutcome(identity: { error: string; retryable?: boolean }): DeviceLicenseReport['outcome'] {
  return identity.retryable === false
    ? { state: 'check-failed', error: identity.error, retryable: false }
    : { state: 'check-failed', error: identity.error }
}

/** Program-identity comparison, case-insensitively — targets report either case. */
function matchesMd5(targetMd5: string, expectedMd5: string): boolean {
  return targetMd5.toLowerCase() === expectedMd5.toLowerCase()
}

/** What `debugger:verify-md5` answers. */
interface Md5VerifyReply {
  success: boolean
  match?: boolean
  targetMd5?: string
  targetEndian?: 'le' | 'be'
  error?: string
}

interface AiStream {
  cancel: () => void
  sender: WebContents
}

const ETHERCAT_SCAN_MODULES_TIMEOUT_MS = 15000
const ETHERCAT_DIAGNOSTICS_TIMEOUT_MS = 13000

const AI_TELEMETRY_EVENTS = [
  'completion_requested',
  'completion_shown',
  'completion_accepted',
  'completion_dismissed',
  'completion_error',
  'completion_timeout',
  'completion_empty',
  'chat_message',
  'chat_rating',
  'conversation_created',
  'conversation_loaded',
  'conversation_renamed',
  'conversation_deleted',
  'acu_exhausted',
  'upgrade_cta_clicked',
] as const satisfies readonly AITelemetryEventName[]

function toAiTelemetryEvent(value: unknown): AITelemetryEventName | undefined {
  return AI_TELEMETRY_EVENTS.find((name) => name === value)
}

const retrievedProjectsRoot = (): string => join(app.getPath('userData'), 'retrieved-projects')

/** True for the scratch root (inclusive) or anything inside it. */
const isRetrievedProjectPath = (projectPath: string): boolean => {
  const rel = relative(retrievedProjectsRoot(), projectPath)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

class MainProcessBridge implements MainIpcModule {
  ipcMain
  mainWindow
  projectService
  store
  menuBuilder
  pouService
  compilerModule
  hardwareModule
  quitCoordinator
  private quitPromptReady = false
  private reloadConfirmed = false
  private registeredHandleChannels: string[] = []
  // One session for a baremetal device, whatever media it runs over.
  private readonly deviceSession = new DeviceSessionManager({
    verify: (client, candidate, context) => this.verifyDeviceCandidate(client, candidate, context),
    probe: (client) => this.probeDeviceLink(client),
    serialPortPresent: (port) => this.hardwareModule.isSerialPortPresent(port),
    emit: (status) => this.emitDeviceLinkStatus(status),
    log: (message) => this.traceDeviceLink(message),
  })
  /** Classification of the candidate the held link came from. */
  private deviceLinkProbe: DeviceProbeOutcome | null = null
  private debuggerConnectionType: 'tcp' | 'rtu' | 'websocket' | 'simulator' | null = null
  private runtimeApi = new RuntimeApiClient()

  // The runtime bootloader client, on its own port and session.
  private bootloaderApi = new BootloaderApiClient()
  // Current project root path used to validate file-watcher IPC calls.
  private currentProjectPath: string | null = null
  // Poll-based file watchers for auto-reload (watchFile, not watch: safe-write renames break fs.watch).
  readonly fileWatchRegistry = new FileWatchRegistry({
    watchFile: (filePath, onChange) => watchFile(filePath, { interval: 1000 }, onChange),
    unwatchFile,
    stat: (filePath) =>
      new Promise((res, rej) => stat(filePath, (err, stats) => (err ? rej(err) : res({ mtimeMs: stats.mtimeMs })))),
    statSync: (filePath) => ({ mtimeMs: statSync(filePath).mtimeMs }),
    canonicalPath: (filePath) => canonicalWatchKey(resolve(filePath), process.platform),
    emitExternalChange: (filePath) => this.mainWindow?.webContents.send('file:external-change', { filePath }),
  })
  // avr8js ATmega2560 emulator instance for the built-in simulator
  private simulatorModule = new SimulatorModule()
  // VPP package manager for board package operations
  private packageManagerModule: PackageManagerModule
  private vppDependencies: VppDependencyService
  private startupDependencies: StartupDependencyCheck
  // System-wide IEC 61131-3 library pool (bundled + user-installed)
  private libraryManagerModule = new LibraryManagerModule()
  // Shared transport for public-catalog HTTP.
  private catalogTransport = createDesktopCatalogTransport()
  // ESI repository service for EtherCAT device descriptions
  private esiFiles = new EsiProjectFiles()

  constructor({
    ipcMain,
    mainWindow,
    projectService,
    store,
    menuBuilder,
    pouService,
    compilerModule,
    hardwareModule,
    quitCoordinator,
    packageManagerModule,
    arduinoDependencies,
  }: MainIpcModuleConstructor) {
    this.packageManagerModule = packageManagerModule ?? new PackageManagerModule()
    this.ipcMain = ipcMain
    this.mainWindow = mainWindow
    this.projectService = projectService
    this.store = store
    this.menuBuilder = menuBuilder
    this.pouService = pouService
    this.compilerModule = compilerModule
    const dependencies =
      arduinoDependencies ??
      createArduinoDependencyServices(this.packageManagerModule, (args) => this.compilerModule.spawnArduinoCli(args))
    this.startupDependencies = dependencies.startup
    this.vppDependencies = dependencies.packages
    this.startupDependencies.setNoticeListener(() =>
      this.mainWindow?.webContents?.send('packages:startup-notices-available'),
    )
    this.hardwareModule = hardwareModule
    this.quitCoordinator = quitCoordinator
    this.mainWindow?.webContents?.on('render-process-gone', () => {
      this.quitPromptReady = false
    })
    this.mainWindow?.webContents?.on('did-start-navigation', ({ isMainFrame, isSameDocument }) => {
      if (!isMainFrame || isSameDocument) return
      this.quitPromptReady = false
      this.reloadConfirmed = false
    })
    this.mainWindow?.webContents?.on('will-prevent-unload', (event) => {
      if (this.reloadConfirmed) event.preventDefault()
    })

    this.tokens.onTokenChanged((newToken) => {
      this.mainWindow?.webContents?.send('runtime:token-refreshed', newToken)
      this.deviceSession.getDebugClient()?.reauth?.(newToken)
    })
  }

  handleBootloaderGetCapabilities = (_event: IpcMainInvokeEvent, ipAddress: string, options?: unknown) => {
    const timeoutMs = capabilitiesTimeoutMs(options)
    return this.bootloaderApi.getCapabilities(ipAddress, timeoutMs === undefined ? undefined : { timeoutMs })
  }

  handleBootloaderLogin = (_event: IpcMainInvokeEvent, ipAddress: string, username: string, password: string) =>
    this.bootloaderApi.login(ipAddress, username, password)

  handleBootloaderGetStatus = (_event: IpcMainInvokeEvent, ipAddress: string) => this.bootloaderApi.getStatus(ipAddress)

  handleBootloaderGetDeviceInfo = (_event: IpcMainInvokeEvent, ipAddress: string) =>
    this.bootloaderApi.getDeviceInfo(ipAddress)

  handleBootloaderGetRuntimeLogs = (_event: IpcMainInvokeEvent, ipAddress: string, tail?: number) =>
    this.bootloaderApi.getRuntimeLogs(ipAddress, tail)

  handleBootloaderStartUpdate = (_event: IpcMainInvokeEvent, ipAddress: string, version: string) =>
    this.bootloaderApi.startUpdate(ipAddress, version)

  handleBootloaderGetUpdateProgress = (_event: IpcMainInvokeEvent, ipAddress: string) =>
    this.bootloaderApi.getUpdateProgress(ipAddress)

  handleBootloaderRestartRuntime = (_event: IpcMainInvokeEvent, ipAddress: string) =>
    this.bootloaderApi.restartRuntime(ipAddress)

  handleBootloaderClearSession = (_event: IpcMainInvokeEvent, ipAddress?: string) => {
    this.bootloaderApi.clearSession(ipAddress)
    return { success: true as const }
  }

  handleRuntimeGetUsersInfo = (_event: IpcMainInvokeEvent, ipAddress: string) => this.runtimeApi.getUsersInfo(ipAddress)

  handleRuntimeGetCapabilities = async (
    _event: IpcMainInvokeEvent,
    ipAddress: string,
  ): Promise<RuntimeCapabilitiesResult> => {
    const parseBody = (data: string): unknown => JSON.parse(data)
    const result = await this.runtimeApi.makeRuntimeApiRequest(
      ipAddress,
      '/api/discovery/ethercat/capabilities',
      parseBody,
    )
    return result.success
      ? capabilitiesFromResponse({ statusCode: 200, body: result.data })
      : capabilitiesFromResponse({ statusCode: result.statusCode, error: result.error })
  }

  handleRuntimeCreateUser = (
    _event: IpcMainInvokeEvent,
    ipAddress: string,
    username: string,
    password: string,
    role?: RuntimeUserRole,
  ) => this.runtimeApi.createUser(ipAddress, username, password, role)

  handleRuntimeListUsers = async (_event: IpcMainInvokeEvent, ipAddress: string) => {
    const res = await this.makeRuntimeApiRequest<RuntimeUser[]>(ipAddress, '/api/get-users-info', (data) => {
      const parsed: unknown = JSON.parse(data)
      return Array.isArray(parsed) ? (parsed as RuntimeUser[]) : []
    })
    return res.success ? { success: true, users: res.data } : { success: false, error: res.error }
  }

  handleRuntimeWhoAmI = async (_event: IpcMainInvokeEvent, ipAddress: string) => {
    const res = await this.makeRuntimeApiRequest<RuntimeUser>(
      ipAddress,
      '/api/whoami',
      (data) => JSON.parse(data) as RuntimeUser,
    )
    return res.success ? { success: true, user: res.data } : { success: false, error: res.error }
  }

  handleRuntimeUpdateUser = async (
    _event: IpcMainInvokeEvent,
    ipAddress: string,
    userId: number,
    params: UpdateUserParams,
  ) => {
    const body: Record<string, string> = {}
    if (params.username !== undefined) body.username = params.username
    if (params.password !== undefined) body.password = params.password
    if (params.currentPassword !== undefined) body.current_password = params.currentPassword
    if (params.role !== undefined) body.role = params.role
    const res = await this.makeRuntimeApiMutation('PUT', ipAddress, `/api/update-user/${userId}`, JSON.stringify(body))
    return res.success ? { success: true } : { success: false, error: res.error }
  }

  handleRuntimeDeleteUser = async (_event: IpcMainInvokeEvent, ipAddress: string, userId: number) => {
    const res = await this.makeRuntimeApiMutation('DELETE', ipAddress, `/api/delete-user/${userId}`)
    return res.success ? { success: true } : { success: false, error: res.error }
  }

  handleRuntimeLogin = (_event: IpcMainInvokeEvent, ipAddress: string, username: string, password: string) =>
    this.runtimeApi.login(ipAddress, username, password)

  /**
   * Wrap a service call with standardized error handling.
   */
  private async wrapServiceCall<T>(fn: () => Promise<T>): Promise<T | { success: false; error: string }> {
    try {
      return await fn()
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  handleRuntimeGetStatus = async (_event: IpcMainInvokeEvent, ipAddress: string, includeStats?: boolean) => {
    try {
      const endpoint = includeStats ? '/api/status?include_stats=true' : '/api/status'

      type PluginStatsField = { label: string; value: string | number | boolean; unit?: string }
      type PluginStatsPayload = { label: string; fields: PluginStatsField[] }
      type PluginStatsMap = Record<string, PluginStatsPayload>
      type TaskStats = {
        name: string
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
      type TimingStatsResponse =
        | { tasks: TaskStats[]; plugin_stats?: PluginStatsMap }
        | (Omit<TaskStats, 'name'> & { tasks?: undefined; plugin_stats?: PluginStatsMap })

      const result = await this.makeRuntimeApiRequest<{
        status: string
        timing_stats?: TimingStatsResponse
        switchPosition?: 'run' | 'stop'
      }>(ipAddress, endpoint, (data: string) => {
        const response = JSON.parse(data) as {
          status: string
          timing_stats?: TimingStatsResponse
          switchPosition?: 'run' | 'stop'
        }
        return response
      })

      if (result.success && result.data) {
        const raw = result.data.timing_stats
        let timingStats: { tasks: TaskStats[]; plugin_stats?: PluginStatsMap } | undefined
        if (raw && Array.isArray((raw as { tasks?: TaskStats[] }).tasks)) {
          timingStats = raw as { tasks: TaskStats[]; plugin_stats?: PluginStatsMap }
        } else if (raw && typeof (raw as { scan_count?: number }).scan_count === 'number') {
          const flat = raw as Omit<TaskStats, 'name'> & { plugin_stats?: PluginStatsMap }
          const { plugin_stats, ...flatStats } = flat
          timingStats = {
            tasks: [{ name: 'plc', ...flatStats }],
            ...(plugin_stats ? { plugin_stats } : {}),
          }
        }
        return {
          success: true,
          status: result.data.status,
          timingStats,
          ...(result.data.switchPosition ? { switchPosition: result.data.switchPosition } : {}),
        }
      } else {
        return { success: false, error: !result.success ? result.error : 'Unknown error' }
      }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  }

  handleRuntimeStartPlc = (_event: IpcMainInvokeEvent, ipAddress: string) => this.restStartPlc(ipAddress)

  handleRuntimeStopPlc = async (_event: IpcMainInvokeEvent, ipAddress: string) => {
    try {
      return await this.makeRuntimeApiRequest(ipAddress, '/api/stop-plc')
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  }

  handleRuntimeGetCompilationStatus = async (_event: IpcMainInvokeEvent, ipAddress: string) => {
    try {
      const result = await this.makeRuntimeApiRequest<{ status: string; logs: string[]; exit_code: number | null }>(
        ipAddress,
        '/api/compilation-status',
        (data: string) => {
          const response = JSON.parse(data) as { status: string; logs: string[]; exit_code: number | null }
          return response
        },
      )
      return result
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  }

  handleRuntimeGetLogs = async (_event: IpcMainInvokeEvent, ipAddress: string, minId?: number) => {
    try {
      const endpoint = minId !== undefined ? `/api/runtime-logs?id=${minId}` : '/api/runtime-logs'
      const result = await this.makeRuntimeApiRequest<string | RuntimeLogEntry[]>(
        ipAddress,
        endpoint,
        (data: string) => {
          const response = JSON.parse(data) as { 'runtime-logs': string | RuntimeLogEntry[] }
          return response['runtime-logs']
        },
      )
      if (result.success) {
        return { success: true, logs: result.data }
      } else {
        return { success: false, error: result.error }
      }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  }

  handleRuntimeClearCredentials = (_event: IpcMainInvokeEvent) => {
    this.tokens.clear()
    this.runtimeApi.clearSession()
    this.bootloaderApi.clearSession()
    return { success: true }
  }

  handleRuntimeDiscoverDevices = async (
    event: IpcMainInvokeEvent,
    opts?: { durationMs?: number },
  ): Promise<{
    success: boolean
    devices?: DiscoveredRuntime[]
    error?: string
  }> => {
    const senderWebContents = event.sender
    const result = await discoverRuntimes({
      durationMs: opts?.durationMs,
      onDevice: (device) => {
        if (!senderWebContents.isDestroyed()) {
          senderWebContents.send('runtime:device-discovered', device)
        }
      },
      onDiagnostic: (message) => logger.debug(message),
    })
    return result.success ? { success: true, devices: result.devices } : { success: false, error: result.error }
  }

  handleRuntimeGetSerialPorts = async (
    _event: IpcMainInvokeEvent,
    ipAddress: string,
  ): Promise<{ success: boolean; ports?: Array<{ device: string; description?: string }>; error?: string }> => {
    try {
      const result = await this.makeRuntimeApiRequest<{ ports: Array<{ device: string; description?: string }> }>(
        ipAddress,
        '/api/serial-ports',
        (data: string) => {
          const response = JSON.parse(data) as {
            ports?: Array<{ device: string; description?: string }>
            error?: string
          }
          if (response.error) {
            throw new Error(response.error)
          }
          return { ports: response.ports || [] }
        },
      )
      if (result.success && result.data) {
        return { success: true, ports: result.data.ports }
      } else {
        return { success: false, error: result.success ? 'No data returned' : result.error }
      }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  }

  /**
   * VPP screen actions (`discover`, `test`, `status`) against the runtime's `POST /api/plugin-command`, reading the
   * plugin's `error` key from the body.
   */
  handleRuntimeSendPluginCommand = async (
    _event: IpcMainInvokeEvent,
    ipAddress: string,
    args: { plugin: string; command: string; params?: Record<string, unknown> },
  ): Promise<PluginCommandOutcome> => {
    try {
      const result = await this.makeRuntimeApiPostRequest(
        ipAddress,
        '/api/plugin-command',
        JSON.stringify({ plugin: args.plugin, command: args.command, params: args.params ?? {} }),
        (data: string) => data,
        PLUGIN_COMMAND_TIMEOUT_MS,
      )
      if (!result.success) {
        return { ok: false, error: result.error }
      }
      let body: unknown
      try {
        body = JSON.parse(result.data)
      } catch {
        return { ok: false, error: 'The device returned an unreadable response.' }
      }
      return interpretPluginCommandResponse(200, body)
    } catch (error) {
      return { ok: false, error: getErrorMessage(error) }
    }
  }

  makeRuntimeApiRequest = <T = void>(
    ipAddress: string,
    endpoint: string,
    responseParser?: (data: string) => T,
  ): Promise<{ success: true; data?: T } | { success: false; error: string }> =>
    this.runtimeApi.makeRuntimeApiRequest(ipAddress, endpoint, responseParser)

  makeRuntimeApiPostRequest = <T>(
    ipAddress: string,
    endpoint: string,
    body: string,
    responseParser: (data: string) => T,
    timeoutMs?: number,
  ): Promise<{ success: true; data: T } | { success: false; error: string }> =>
    this.runtimeApi.makeRuntimeApiPostRequest(ipAddress, endpoint, body, responseParser, timeoutMs)

  makeRuntimeApiUpload = (opts: {
    ipAddress: string
    fileBuffer: Buffer
    filename: string
    contentType: string
    cleanBuild: boolean
    snapshotBuffer?: Buffer
    snapshotMetadata?: string
    onUploadAccepted?: (responseBody: string) => void
  }): Promise<{ success: true; data: string } | { success: false; error: string }> =>
    this.runtimeApi.makeRuntimeApiUpload(opts)

  /** Username of the live runtime session. */
  getRuntimeUsername = (): string | null => this.runtimeApi.tokens.getUsername()

  /**
   * Install the libraries a retrieved project brought with it, with the same strucpp validation as a library the user
   * picked.
   */
  handleInstallRetrievedLibraries = async (
    _event: IpcMainInvokeEvent,
    projectPath: string,
    names: string[],
  ): Promise<{ success: boolean; installed: string[]; failed: Array<{ name: string; error: string }> }> => {
    const archives = this.retrievedLibraries.get(projectPath) ?? []
    const manager = new LibraryManagerModule()
    const installed: string[] = []
    const failed: Array<{ name: string; error: string }> = []

    for (const library of archives) {
      if (!names.includes(library.name)) continue
      const result = await manager.installFromText(library.archive)
      if (result.success) installed.push(library.name)
      else failed.push({ name: library.name, error: result.error ?? 'Install failed' })
    }
    return { success: failed.length === 0, installed, failed }
  }

  /** Retrieve the stored project and write it to a scratch directory. Returns its path and description. */
  /** Bundled library archives from the most recent retrievals, keyed by project path. */
  private retrievedLibraries = new Map<string, Array<{ name: string; archive: string }>>()

  /** Drops every retrieved project's libraries except the one just retrieved. */
  private forgetRetrievedLibrariesExcept(keep: string): void {
    for (const path of [...this.retrievedLibraries.keys()]) {
      if (path !== keep) this.retrievedLibraries.delete(path)
    }
  }

  handleRuntimeRetrieveProject = async (
    _event: IpcMainInvokeEvent,
    ipAddress: string,
  ): Promise<{
    success: boolean
    projectPath?: string
    projectName?: string
    metadata?: SnapshotMetadata
    libraries?: Array<{ name: string; version: string; status: 'installed' | 'differs' | 'missing' }>
    error?: string
  }> => {
    const fetched = await this.runtimeApi.retrieveProjectSnapshot(ipAddress)
    if (!fetched.success) return { success: false, error: fetched.error }

    try {
      const scratchRoot = retrievedProjectsRoot()
      await pruneRetrievedProjects(scratchRoot, RETAINED_RETRIEVALS)
      try {
        await this.forgetRetrievedProjectsInHistory()
      } catch (error) {
        logger.error('Could not drop retrieved projects from history: ' + getErrorMessage(error))
      }

      const materialized = await materializeRetrievedProject(new Uint8Array(fetched.archive), {
        scratchRoot,
      })
      this.forgetRetrievedLibrariesExcept(materialized.projectPath)
      this.retrievedLibraries.set(
        materialized.projectPath,
        materialized.libraries.map(({ name, archive }) => ({ name, archive })),
      )
      return {
        success: true,
        projectPath: materialized.projectPath,
        projectName: materialized.projectName,
        metadata: materialized.metadata,
        libraries: await describeRetrievedLibraries(materialized.libraries, (name) =>
          new LibraryManagerModule().readArchiveText(name),
        ),
      }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  }

  private makeRuntimeApiMutation = (
    method: 'POST' | 'PUT' | 'DELETE',
    ipAddress: string,
    endpoint: string,
    body?: string,
  ): Promise<{ success: true; data: string } | { success: false; error: string }> =>
    this.runtimeApi.makeRuntimeApiMutation(method, ipAddress, endpoint, body)

  private restStartPlc = (address: string) => this.runtimeApi.startPlc(address)

  /** The token authority. */
  private get tokens() {
    return this.runtimeApi.tokens
  }

  private get runtimeIp(): string | null {
    return this.runtimeApi.getAddress()
  }

  /** Registers an invoke handler and tracks the channel for cleanup. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private registerHandle(channel: string, handler: (event: IpcMainInvokeEvent, ...args: any[]) => any) {
    this.registeredHandleChannels.push(channel)
    this.ipcMain.handle(channel, handler)
  }

  /** Removes previously registered invoke handlers so they can be re-registered with fresh references on macOS window reopen. */
  private cleanupHandlers() {
    for (const channel of this.registeredHandleChannels) {
      this.ipcMain.removeHandler(channel)
    }
    this.registeredHandleChannels = []
  }

  setupMainIpcListener() {
    this.cleanupHandlers()

    this.registerHandle('project:create', this.handleProjectCreate)
    this.registerHandle('project:open', this.handleProjectOpen)
    this.registerHandle('project:path-picker', this.handleProjectPathPicker)
    this.registerHandle('project:open-path-picker', this.handleOpenProjectPathPicker)
    this.registerHandle('project:write-files', this.handleWriteProjectFiles)
    this.registerHandle('project:save-file', this.handleFileSave)
    this.registerHandle('project:open-by-path', this.handleProjectOpenByPath)
    this.registerHandle('project:read-files', this.handleReadProjectFiles)
    this.registerHandle('project:pick-plcopen-import-file', this.handlePickPlcopenImportFile)
    this.registerHandle('project:export-plcopen-file', this.handleExportPlcopenFile)
    this.registerHandle('project:export-pdf-file', this.handleExportPdfFile)

    this.registerHandle('pou:create', this.handleCreatePouFile)
    this.registerHandle('pou:delete', this.handleDeletePouFile)
    this.registerHandle('pou:rename', this.handleRenamePouFile)

    this.registerHandle('open-external-link', this.handleOpenExternalLink)
    this.registerHandle('system:get-system-info', this.handleGetSystemInfo)
    this.registerHandle('libraries:load-all', this.handleLibrariesLoadAll)
    this.registerHandle('libraries:list-installed', this.handleLibrariesListInstalled)
    this.registerHandle('libraries:install-from-file', this.handleLibrariesInstallFromFile)
    this.registerHandle('libraries:uninstall', this.handleLibrariesUninstall)
    this.registerHandle('catalog:list', this.handleCatalogList)
    this.registerHandle('edge-account:fetch-user', this.handleEdgeFetchUser)
    this.registerHandle('edge-account:fetch-plan-caption', this.handleEdgeFetchPlanCaption)
    this.registerHandle('edge-account:sign-in', this.handleEdgeSignIn)
    this.registerHandle('edge-account:sign-out', this.handleEdgeSignOut)
    this.registerHandle('edge-account:is-session-persistent', this.handleEdgeIsSessionPersistent)
    this.registerHandle('edge-projects:list-recent', this.handleEdgeProjectsListRecent)
    this.registerHandle('edge-projects:list-in-folder', this.handleEdgeProjectsListInFolder)
    this.registerHandle('edge-projects:read', this.handleEdgeProjectsRead)
    this.registerHandle('edge-projects:save-project', this.handleEdgeProjectsSaveProject)
    this.registerHandle('edge-projects:save-file', this.handleEdgeProjectsSaveFile)
    this.registerHandle('edge-edit-session:open', this.handleEdgeEditSessionOpen)
    this.registerHandle('edge-edit-session:heartbeat', this.handleEdgeEditSessionHeartbeat)
    this.registerHandle('edge-edit-session:close', this.handleEdgeEditSessionClose)
    this.registerHandle('edge-upload:list-folders', this.handleEdgeUploadListFolders)
    this.registerHandle('edge-upload:project', this.handleEdgeUploadProject)
    this.registerHandle('edge-vc:list-branches', this.handleEdgeVcListBranches)
    this.registerHandle('edge-vc:create-branch', this.handleEdgeVcCreateBranch)
    this.registerHandle('edge-vc:delete-branch', this.handleEdgeVcDeleteBranch)
    this.registerHandle('edge-vc:switch-branch', this.handleEdgeVcSwitchBranch)
    this.registerHandle('edge-vc:preview-switch-carry', this.handleEdgeVcPreviewSwitchCarry)
    this.registerHandle('edge-vc:list-commits', this.handleEdgeVcListCommits)
    this.registerHandle('edge-vc:create-commit', this.handleEdgeVcCreateCommit)
    this.registerHandle('edge-vc:get-commit-files', this.handleEdgeVcGetCommitFiles)
    this.registerHandle('edge-vc:restore-commit', this.handleEdgeVcRestoreCommit)
    this.registerHandle('edge-vc:get-changes', this.handleEdgeVcGetChanges)
    this.registerHandle('edge-vc:discard-changes', this.handleEdgeVcDiscardChanges)
    this.registerHandle('edge-vc:list-stashes', this.handleEdgeVcListStashes)
    this.registerHandle('edge-vc:create-stash', this.handleEdgeVcCreateStash)
    this.registerHandle('edge-vc:apply-stash', this.handleEdgeVcApplyStash)
    this.registerHandle('edge-vc:pop-stash', this.handleEdgeVcPopStash)
    this.registerHandle('edge-vc:drop-stash', this.handleEdgeVcDropStash)
    this.registerHandle('edge-vc:branch-diff-with-base', this.handleEdgeVcBranchDiffWithBase)
    this.registerHandle('edge-vc:merge-branches', this.handleEdgeVcMergeBranches)
    this.registerHandle('edge-ai:entitlements', this.handleEdgeAiEntitlements)
    this.registerHandle('edge-ai:usage', this.handleEdgeAiUsage)
    this.registerHandle('edge-ai:credits', this.handleEdgeAiCredits)
    this.registerHandle('edge-ai:warm', this.handleEdgeAiWarm)
    this.registerHandle('edge-ai:telemetry', this.handleEdgeAiTelemetry)
    this.registerHandle('edge-ai:conversations-list', this.handleEdgeAiConversationsList)
    this.registerHandle('edge-ai:conversations-get', this.handleEdgeAiConversationsGet)
    this.registerHandle('edge-ai:conversations-create', this.handleEdgeAiConversationsCreate)
    this.registerHandle('edge-ai:conversations-rename', this.handleEdgeAiConversationsRename)
    this.registerHandle('edge-ai:conversations-delete', this.handleEdgeAiConversationsDelete)
    this.registerHandle('edge-ai:stream-start', this.handleEdgeAiStreamStart)
    this.registerHandle('edge-ai:stream-abort', this.handleEdgeAiStreamAbort)
    this.registerHandle('catalog:install-many', this.handleCatalogInstallMany)
    this.registerHandle('app:store-retrieve-recent', this.handleStoreRetrieveRecent)
    this.registerHandle('project:remove-from-recent', this.handleRemoveProjectFromRecent)
    this.registerHandle('project:track-recent', this.handleTrackRecentProject)
    this.registerHandle('project:delete', this.handleDeleteProject)
    this.ipcMain.on('app:request-quit', this.handleAppRequestQuit)
    this.ipcMain.on('app:quit-ready', this.handleAppQuitReady)
    this.ipcMain.on('app:quit-unready', this.handleAppQuitUnready)
    this.ipcMain.on('app:quit', this.handleAppQuit)

    this.ipcMain.on('system:update-theme', this.mainIpcEventHandlers.handleUpdateTheme)
    this.ipcMain.handle('system:get-theme', this.mainIpcEventHandlers.handleGetTheme)

    this.ipcMain.on('compiler:run-compile-program', this.handleRunCompileProgram)
    this.ipcMain.on('compiler:run-debug-compilation', this.handleRunDebugCompilation)
    this.ipcMain.on('compiler:run-compile-library', this.handleRunCompileLibrary)

    this.ipcMain.on('window-controls:close', this.handleWindowControlsClose)
    this.ipcMain.on('window-controls:closed', this.handleWindowControlsClosed)
    this.ipcMain.on('window-controls:hide', this.handleWindowControlsHide)
    this.ipcMain.on('window-controls:minimize', this.handleWindowControlsMinimize)
    this.ipcMain.on('window-controls:maximize', this.handleWindowControlsMaximize)
    this.ipcMain.on('window:reload', this.handleWindowReload)
    this.ipcMain.on('window:rebuild-menu', this.handleWindowRebuildMenu)
    this.ipcMain.on('window:project-open', this.handleWindowProjectOpen)
    this.ipcMain.on('window:debugger-active', this.handleWindowDebuggerActive)

    this.registerHandle('hardware:get-available-communication-ports', this.handleHardwareGetAvailableCommunicationPorts)
    this.registerHandle('hardware:get-available-boards', this.handleHardwareGetAvailableBoards)
    this.registerHandle('hardware:refresh-communication-ports', this.handleHardwareRefreshCommunicationPorts)
    this.registerHandle('hardware:refresh-available-boards', this.handleHardwareRefreshAvailableBoards)

    this.registerHandle('packages:import-from-file', this.handlePackagesImportFromFile)
    this.registerHandle('packages:install-from-url', this.handlePackagesInstallFromUrl)
    this.registerHandle('packages:list-installed', this.handlePackagesListInstalled)
    this.registerHandle('packages:uninstall', this.handlePackagesUninstall)
    this.registerHandle('packages:reinstall', this.handlePackagesReinstall)
    this.registerHandle('packages:take-startup-notices', this.handlePackagesTakeStartupNotices)
    this.ipcMain.on('packages:cancel-install', this.handlePackagesCancelInstall)
    this.registerHandle('packages:get-manifest', this.handlePackagesGetManifest)
    this.registerHandle('packages:get-pin', this.handlePackagesGetPin)
    this.registerHandle('packages:verify-signatures', this.handlePackagesVerifySignatures)

    this.registerHandle('util:get-preview-image', this.handleUtilGetPreviewImage)
    this.ipcMain.on('util:log', this.handleUtilLog)
    this.registerHandle('util:read-debug-file', this.handleReadDebugFile)

    this.registerHandle('wasm-toolchain:compile', this.handleWasmToolchainCompile)

    this.registerHandle('debugger:verify-md5', this.handleDebuggerVerifyMd5)
    this.registerHandle('debugger:plc-control', this.handleDebuggerPlcControl)
    this.registerHandle('debugger:read-program-st-md5', this.handleReadProgramStMd5)
    this.registerHandle('debugger:get-variables-list', this.handleDebuggerGetVariablesList)
    this.registerHandle('debugger:set-variable', this.handleDebuggerSetVariable)
    this.registerHandle('debugger:connect', this.handleDebuggerConnect)
    this.registerHandle('debugger:disconnect', this.handleDebuggerDisconnect)
    this.registerHandle('device:connect', this.handleDeviceConnect)
    this.registerHandle('device:disconnect', this.handleDeviceDisconnect)
    this.registerHandle('device:release-serial-port', this.handleDeviceReleaseSerialPort)
    this.registerHandle('device:read-license', this.handleDeviceReadLicense)
    this.registerHandle('device:refresh-license', this.handleDeviceRefreshLicense)
    this.registerHandle('session:open-runtime', this.handleOpenRuntimeSession)
    this.registerHandle('session:close-runtime', this.handleCloseRuntimeSession)

    this.registerHandle('runtime:get-users-info', this.handleRuntimeGetUsersInfo)
    this.registerHandle('runtime:get-capabilities', this.handleRuntimeGetCapabilities)
    this.registerHandle('runtime:create-user', this.handleRuntimeCreateUser)
    this.registerHandle('runtime:list-users', this.handleRuntimeListUsers)
    this.registerHandle('runtime:whoami', this.handleRuntimeWhoAmI)
    this.registerHandle('runtime:update-user', this.handleRuntimeUpdateUser)
    this.registerHandle('runtime:delete-user', this.handleRuntimeDeleteUser)
    this.registerHandle('runtime:login', this.handleRuntimeLogin)
    this.registerHandle('runtime:get-status', this.handleRuntimeGetStatus)
    this.registerHandle('runtime:start-plc', this.handleRuntimeStartPlc)
    this.registerHandle('runtime:stop-plc', this.handleRuntimeStopPlc)
    this.registerHandle('runtime:get-compilation-status', this.handleRuntimeGetCompilationStatus)
    this.registerHandle('runtime:get-logs', this.handleRuntimeGetLogs)
    this.registerHandle('runtime:clear-credentials', this.handleRuntimeClearCredentials)
    this.registerHandle('runtime:get-serial-ports', this.handleRuntimeGetSerialPorts)
    this.registerHandle('runtime:send-plugin-command', this.handleRuntimeSendPluginCommand)
    this.registerHandle('runtime:discover-devices', this.handleRuntimeDiscoverDevices)
    this.registerHandle('runtime:retrieve-project', this.handleRuntimeRetrieveProject)
    this.registerHandle('runtime:install-retrieved-libraries', this.handleInstallRetrievedLibraries)

    this.registerHandle('bootloader:get-capabilities', this.handleBootloaderGetCapabilities)
    this.registerHandle('bootloader:login', this.handleBootloaderLogin)
    this.registerHandle('bootloader:get-status', this.handleBootloaderGetStatus)
    this.registerHandle('bootloader:get-device-info', this.handleBootloaderGetDeviceInfo)
    this.registerHandle('bootloader:get-runtime-logs', this.handleBootloaderGetRuntimeLogs)
    this.registerHandle('bootloader:start-update', this.handleBootloaderStartUpdate)
    this.registerHandle('bootloader:get-update-progress', this.handleBootloaderGetUpdateProgress)
    this.registerHandle('bootloader:restart-runtime', this.handleBootloaderRestartRuntime)
    this.registerHandle('bootloader:clear-session', this.handleBootloaderClearSession)

    this.registerHandle('ethercat:get-interfaces', this.handleEtherCATGetInterfaces)
    this.registerHandle('ethercat:get-status', this.handleEtherCATGetStatus)
    this.registerHandle('ethercat:scan', this.handleEtherCATScan)
    this.registerHandle('ethercat:scan-modules', this.handleEtherCATScanModules)
    this.registerHandle('ethercat:diagnostics', this.handleEtherCATDiagnostics)
    this.registerHandle('ethercat:test', this.handleEtherCATTest)
    this.registerHandle('ethercat:validate', this.handleEtherCATValidate)
    this.registerHandle('ethercat:get-runtime-status', this.handleEtherCATGetRuntimeStatus)

    this.registerHandle('esi:parse', this.handleESIParse)
    this.registerHandle('esi:file-read', this.handleESIFileRead)
    this.registerHandle('esi:file-write', this.handleESIFileWrite)
    this.registerHandle('esi:file-remove', this.handleESIFileRemove)
    this.registerHandle('esi:file-list', this.handleESIFileList)

    this.registerHandle('simulator:load-firmware', this.handleSimulatorLoadFirmware)
    this.registerHandle('simulator:stop', this.handleSimulatorStop)
    this.registerHandle('simulator:is-running', this.handleSimulatorIsRunning)

    this.registerHandle('file:watch-start', this.handleFileWatchStart)
    this.registerHandle('file:watch-stop', this.handleFileWatchStop)
    this.registerHandle('file:watch-stop-all', this.handleFileWatchStopAll)
    this.registerHandle('file:read-content', this.handleFileReadContent)
  }

  handleProjectCreate = async (_event: IpcMainInvokeEvent, data: CreateProjectFileProps) => {
    this.stopSimulatorAndNotify()
    const response = await this.projectService.createProject(data)
    if (response.success && response.data?.meta.path) {
      this.currentProjectPath = response.data.meta.path
    }
    return response
  }
  handleProjectOpen = async () => {
    this.stopSimulatorAndNotify()
    const response = await this.projectService.openProject()
    if (response.success && response.data?.meta.path) {
      this.currentProjectPath = response.data.meta.path
    }
    return response
  }
  handleProjectPathPicker = async (_event: IpcMainInvokeEvent) => {
    const windowManager = this.mainWindow
    try {
      if (windowManager) {
        const res = await getProjectPath(windowManager)
        return res
      }
      logger.error('Window object not defined')
    } catch (error) {
      logger.error('Error getting project path: ' + getErrorMessage(error))
    }
  }
  handleOpenProjectPathPicker = async (_event: IpcMainInvokeEvent) => {
    const windowManager = this.mainWindow
    try {
      if (windowManager) {
        const res = await getOpenProjectPath(windowManager)
        return res
      }
      logger.error('Window object not defined')
      return { success: false, error: { title: 'Internal error', description: 'Window object not defined' } }
    } catch (error) {
      logger.error('Error getting project path: ' + getErrorMessage(error))
      return { success: false, error: { title: 'Internal error', description: getErrorMessage(error) } }
    }
  }
  handleFileSave = async (_event: IpcMainInvokeEvent, filePath: string, content: unknown) => {
    const result = await this.projectService.saveFile(filePath, content as string)
    if (result.success) {
      this.fileWatchRegistry.recordOwnWrite(filePath)
    }
    return result
  }
  handleWriteProjectFiles = (_event: IpcMainInvokeEvent, files: unknown) =>
    this.projectService.writeProjectFiles(files as Parameters<typeof this.projectService.writeProjectFiles>[0], {
      onFileWritten: (absolutePath) => this.fileWatchRegistry.recordOwnWrite(absolutePath),
    })
  handleProjectOpenByPath = async (_event: IpcMainInvokeEvent, projectPath: string) => {
    this.stopSimulatorAndNotify()
    try {
      const response = await this.projectService.openProjectByPath(projectPath)
      if (response.success && response.data?.meta.path) {
        this.currentProjectPath = response.data.meta.path
      }
      return response
    } catch (_error) {
      return {
        success: false,
        error: {
          title: 'Error opening project',
          description: 'Please try again',
        },
      }
    }
  }

  private forgetRetrievedProjectsInHistory = async (): Promise<void> => {
    const historyPath = this.projectService.getHistoryProjectsFilePath()
    const history = await this.projectService.readProjectHistory(historyPath)
    const kept = history.filter((entry) => !isRetrievedProjectPath(entry.path))
    if (kept.length === history.length) return
    await this.projectService.replaceProjectHistory(historyPath, kept)
  }

  handleReadProjectFiles = async (_event: IpcMainInvokeEvent, projectPath: string) => {
    try {
      this.stopSimulatorAndNotify()
      const result = await this.projectService.readRawProjectFiles(projectPath)
      if (result.success) {
        if (!isRetrievedProjectPath(projectPath)) {
          await this.projectService.updateProjectHistory(projectPath)
        }
        this.currentProjectPath = projectPath
      }
      return result
    } catch (_error) {
      return {
        success: false,
        error: { title: 'Error reading project', description: 'Failed to read project files' },
      }
    } finally {
      this.handleWindowRebuildMenu()
    }
  }

  handlePickPlcopenImportFile = async (_event: IpcMainInvokeEvent) => {
    const windowManager = this.mainWindow
    try {
      if (windowManager) {
        const res = await getPlcopenImportFilePath(windowManager)
        return res
      }
      logger.error('Window object not defined')
      return { success: false, error: { title: 'Internal error', description: 'Window object not defined' } }
    } catch (error) {
      logger.error('Error picking PLCopen import file: ' + getErrorMessage(error))
      return { success: false, error: { title: 'Internal error', description: getErrorMessage(error) } }
    }
  }

  handleExportPlcopenFile = async (_event: IpcMainInvokeEvent, defaultFileName: string, xml: string) => {
    const windowManager = this.mainWindow
    try {
      if (windowManager) {
        const res = await getPlcopenExportSavePath(windowManager, defaultFileName, xml)
        return res
      }
      logger.error('Window object not defined')
      return { success: false, error: { title: 'Internal error', description: 'Window object not defined' } }
    } catch (error) {
      logger.error('Error exporting PLCopen file: ' + getErrorMessage(error))
      return { success: false, error: { title: 'Internal error', description: getErrorMessage(error) } }
    }
  }

  handleExportPdfFile = async (_event: IpcMainInvokeEvent, defaultFileName: string, bytes: Uint8Array) => {
    const windowManager = this.mainWindow
    try {
      if (windowManager) {
        const res = await getPdfExportSavePath(windowManager, defaultFileName, bytes)
        return res
      }
      logger.error('Window object not defined')
      return { success: false, error: { title: 'Internal error', description: 'Window object not defined' } }
    } catch (error) {
      logger.error('Error exporting PDF file: ' + getErrorMessage(error))
      return { success: false, error: { title: 'Internal error', description: getErrorMessage(error) } }
    }
  }

  handleCreatePouFile = async (_event: IpcMainInvokeEvent, props: CreatePouFileProps) => {
    try {
      const response = await this.pouService.createPouFile(props)
      return response
    } catch (error) {
      logger.error('Error creating POU file: ' + getErrorMessage(error))
      return {
        success: false,
        error: {
          title: 'Error creating POU file',
          description: 'Please try again',
          error,
        },
      }
    }
  }
  handleDeletePouFile = async (_event: IpcMainInvokeEvent, filePath: string) => {
    try {
      const response = await this.pouService.deletePouFile(filePath)
      return response
    } catch (error) {
      logger.error('Error deleting POU file: ' + getErrorMessage(error))
      return {
        success: false,
        error: {
          title: 'Error deleting POU file',
          description: 'Please try again',
          error,
        },
      }
    }
  }
  handleRenamePouFile = async (
    _event: IpcMainInvokeEvent,
    data: {
      filePath: string
      newFileName: string
      fileContent?: unknown
    },
  ) => {
    try {
      const response = await this.pouService.renamePouFile(data)
      return response
    } catch (error) {
      logger.error('Error renaming POU file: ' + getErrorMessage(error))
      return {
        success: false,
        error: {
          title: 'Error renaming POU file',
          description: 'Please try again',
          error,
        },
      }
    }
  }

  handleOpenExternalLink = async (_event: IpcMainInvokeEvent, url: string) => {
    if (typeof url !== 'string' || !isWebUrl(url)) {
      logger.warn(`Refused to open a non-web external link: ${String(url).slice(0, 120)}`)
      return { success: false, error: 'Only http(s) links can be opened.' }
    }

    try {
      await shell.openExternal(url)
      return { success: true }
    } catch (error) {
      logger.error('Error opening external link: ' + getErrorMessage(error))
      return { success: false, error }
    }
  }
  handleGetSystemInfo = () => {
    const appStore = this.store as unknown as { get: (key: string) => unknown }
    const savedTheme = appStore.get('theme')
    if (savedTheme === 'dark' || savedTheme === 'light') {
      nativeTheme.themeSource = savedTheme
    }

    const isWindowMaximized = this.mainWindow && !this.mainWindow.isDestroyed() ? this.mainWindow.isMaximized() : false

    return {
      OS: platform,
      architecture: 'x64',
      prefersDarkMode: nativeTheme.shouldUseDarkColors,
      isWindowMaximized,
    }
  }

  /** Loads bundled .stlib archives from `<resources>/strucpp/libs/`, alphabetically. Errors propagate. */
  handleLibrariesLoadAll = async (): Promise<unknown[]> => this.libraryManagerModule.loadAll()
  handleLibrariesListInstalled = async () => this.libraryManagerModule.listInstalled()
  handleLibrariesInstallFromFile = async () => {
    if (!this.mainWindow) return { success: false, error: 'No main window' }
    const result = await dialog.showOpenDialog(this.mainWindow, {
      title: 'Install Library',
      filters: [
        { name: 'Library files', extensions: ['stlib', 'lib', 'library'] },
        { name: 'STruC++ archive', extensions: ['stlib'] },
        { name: 'CODESYS library', extensions: ['lib', 'library'] },
      ],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { success: true, canceled: true }
    }
    const installResult = await this.libraryManagerModule.installFromFile(result.filePaths[0])
    if (installResult.success && !installResult.canceled) {
      this.mainWindow.webContents.send('libraries:changed')
    }
    return installResult
  }
  handleLibrariesUninstall = async (_event: IpcMainInvokeEvent, name: string) => {
    const result = this.libraryManagerModule.uninstall(name)
    if (result.success) {
      this.mainWindow?.webContents.send('libraries:changed')
    }
    return result
  }

  /**
   * Catalog browse through the shared `listPublicLibraries` client. Errors are returned in a `{ success: false, error
   * }` envelope.
   */

  handleEdgeFetchUser = (_event: IpcMainInvokeEvent): Promise<EdgeUserRead> => fetchEdgeUser()

  handleEdgeFetchPlanCaption = (_event: IpcMainInvokeEvent): Promise<string | null> => fetchEdgePlanCaption()

  handleEdgeSignIn = (
    _event: IpcMainInvokeEvent,
    credentials: { email: string; password: string },
  ): Promise<EdgeSignInOutcome> => {
    if (typeof credentials?.email !== 'string' || typeof credentials?.password !== 'string') {
      return Promise.resolve({ status: 'failed' })
    }

    return signInToEdge(credentials.email, credentials.password)
  }

  handleEdgeSignOut = (_event: IpcMainInvokeEvent): Promise<void> => signOutOfEdge()

  handleEdgeIsSessionPersistent = (_event: IpcMainInvokeEvent): Promise<boolean> =>
    Promise.resolve(isEncryptionAvailable())

  handleEdgeProjectsListRecent = (_event: IpcMainInvokeEvent, limit: unknown): Promise<CloudProjectsResult> => {
    const requested = typeof limit === 'number' && Number.isInteger(limit) ? limit : 5

    return listRecentCloudProjects(Math.min(Math.max(requested, 1), 50))
  }

  handleEdgeProjectsListInFolder = (_event: IpcMainInvokeEvent, folderId: unknown): Promise<CloudProjectsResult> => {
    if (typeof folderId !== 'string' || folderId.length === 0) {
      return Promise.resolve({ status: 'unreachable' })
    }

    return listCloudProjectsInFolder(folderId)
  }

  handleEdgeProjectsRead = (_event: IpcMainInvokeEvent, projectId: unknown): Promise<RawProjectFiles> => {
    if (typeof projectId !== 'string' || projectId.length === 0) {
      return Promise.resolve({
        success: false,
        error: { title: 'Failed to open project', description: 'No project id was given.' },
      })
    }

    return readCloudProject(projectId)
  }

  /** Takes `unknown` and validates it before saving the project. */
  handleEdgeProjectsSaveProject = (
    _event: IpcMainInvokeEvent,
    files: unknown,
  ): Promise<{ success: boolean; error?: string }> => {
    const parsed = WriteProjectFilesSchema.safeParse(files)

    if (!parsed.success) {
      return Promise.resolve({ success: false, error: 'The editor made an invalid save request.' })
    }

    return saveCloudProject(parsed.data)
  }

  handleEdgeProjectsSaveFile = (
    _event: IpcMainInvokeEvent,
    filePath: unknown,
    content: unknown,
  ): Promise<{ success: boolean; error?: string }> => {
    if (typeof filePath !== 'string' || filePath.length === 0) {
      return Promise.resolve({ success: false, error: 'No file path was given.' })
    }

    return saveCloudFile(filePath, content)
  }

  handleEdgeEditSessionOpen = (
    _event: IpcMainInvokeEvent,
    projectId: unknown,
    client: unknown,
    previousSessionId: unknown,
  ): Promise<EditSessionOpened> => {
    const parsed = EditSessionClientSchema.safeParse(client)

    if (
      !isNonEmptyString(projectId) ||
      !parsed.success ||
      (previousSessionId !== undefined && !isNonEmptyString(previousSessionId))
    ) {
      return Promise.resolve({ status: 'unavailable', permanent: true })
    }

    return openEditSession(projectId, parsed.data, previousSessionId)
  }

  handleEdgeEditSessionHeartbeat = (
    _event: IpcMainInvokeEvent,
    projectId: unknown,
    sessionId: unknown,
  ): Promise<EditSessionBeat> => {
    if (!isNonEmptyString(projectId) || !isNonEmptyString(sessionId)) {
      return Promise.resolve({ status: 'unknown' })
    }

    return heartbeatEditSession(projectId, sessionId)
  }

  handleEdgeEditSessionClose = (
    _event: IpcMainInvokeEvent,
    projectId: unknown,
    sessionId: unknown,
    closedBySessionId: unknown,
  ): Promise<boolean> => {
    if (
      !isNonEmptyString(projectId) ||
      !isNonEmptyString(sessionId) ||
      (closedBySessionId !== undefined && !isNonEmptyString(closedBySessionId))
    ) {
      return Promise.resolve(false)
    }

    return closeEditSession(projectId, sessionId, closedBySessionId)
  }

  /** Non-empty string, or nothing. */
  private static vcString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined
  }

  private static vcRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value))
      : {}
  }

  /** An array of non-empty strings, or nothing — never a partially valid list. */
  private static vcStringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) {
      return undefined
    }

    const strings = value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)

    return strings.length === value.length ? strings : undefined
  }

  private static readonly VC_BAD_REQUEST = {
    ok: false,
    failure: { kind: 'http', status: 400, message: 'The editor made an invalid version-control request.' },
  } as const satisfies VersionControlResult<never>

  handleEdgeUploadListFolders = (): Promise<CloudFoldersResult> => listCloudFolders()

  /** Validates `projectPath`, `parentFolderId` and `visibility` before it touches the filesystem. */
  handleEdgeUploadProject = (_event: IpcMainInvokeEvent, params: unknown): Promise<UploadProjectResult> => {
    const source = MainProcessBridge.vcRecord(params)
    const projectPath = MainProcessBridge.vcString(source.projectPath)
    const parentFolderId = MainProcessBridge.vcString(source.parentFolderId)

    if (!projectPath || !parentFolderId) {
      return Promise.resolve({
        status: 'failed',
        failure: { reason: 'unreadable', message: 'The editor made an invalid upload request.' },
      })
    }

    return uploadProjectToCloud({
      projectPath,
      parentFolderId,
      projectName: MainProcessBridge.vcString(source.projectName),
      visibility: source.visibility === 'public' ? 'public' : 'private',
    })
  }

  handleEdgeVcBranchDiffWithBase = (
    _event: IpcMainInvokeEvent,
    projectId: unknown,
    source: unknown,
    target: unknown,
  ): Promise<VersionControlResult<unknown>> => {
    const id = MainProcessBridge.vcString(projectId)
    const from = MainProcessBridge.vcString(source)
    const to = MainProcessBridge.vcString(target)

    return id && from && to ? getBranchDiffWithBase(id, from, to) : Promise.resolve(MainProcessBridge.VC_BAD_REQUEST)
  }

  handleEdgeVcMergeBranches = (_event: IpcMainInvokeEvent, params: unknown): Promise<VersionControlResult<unknown>> => {
    const source = MainProcessBridge.vcRecord(params)
    const projectId = MainProcessBridge.vcString(source.projectId)
    const sourceBranch = MainProcessBridge.vcString(source.sourceBranch)
    const targetBranch = MainProcessBridge.vcString(source.targetBranch)

    if (!projectId || !sourceBranch || !targetBranch) {
      return Promise.resolve(MainProcessBridge.VC_BAD_REQUEST)
    }

    let resolutions: Record<string, string> | undefined

    if (source.resolutions !== undefined) {
      const record = MainProcessBridge.vcRecord(source.resolutions)
      const entries = Object.entries(record)

      if (!entries.every(([key, value]) => key.length > 0 && typeof value === 'string')) {
        return Promise.resolve(MainProcessBridge.VC_BAD_REQUEST)
      }

      resolutions = Object.fromEntries(entries.map(([key, value]) => [key, String(value)]))
    }

    return mergeBranches({
      projectId,
      sourceBranch,
      targetBranch,
      commitMessage: MainProcessBridge.vcString(source.commitMessage),
      resolutions,
    })
  }

  handleEdgeVcListBranches = (
    _event: IpcMainInvokeEvent,
    projectId: unknown,
  ): Promise<VersionControlResult<unknown>> => {
    const id = MainProcessBridge.vcString(projectId)

    return id ? listBranches(id) : Promise.resolve(MainProcessBridge.VC_BAD_REQUEST)
  }

  handleEdgeVcCreateBranch = (
    _event: IpcMainInvokeEvent,
    projectId: unknown,
    name: unknown,
  ): Promise<VersionControlResult<unknown>> => {
    const id = MainProcessBridge.vcString(projectId)
    const branchName = MainProcessBridge.vcString(name)

    return id && branchName ? createBranch(id, branchName) : Promise.resolve(MainProcessBridge.VC_BAD_REQUEST)
  }

  handleEdgeVcDeleteBranch = (
    _event: IpcMainInvokeEvent,
    projectId: unknown,
    branchId: unknown,
  ): Promise<VersionControlResult<unknown>> => {
    const id = MainProcessBridge.vcString(projectId)
    const branch = MainProcessBridge.vcString(branchId)

    return id && branch ? deleteBranch(id, branch) : Promise.resolve(MainProcessBridge.VC_BAD_REQUEST)
  }

  handleEdgeVcSwitchBranch = (
    _event: IpcMainInvokeEvent,
    projectId: unknown,
    branchName: unknown,
    strategy: unknown,
  ): Promise<VersionControlResult<unknown>> => {
    const id = MainProcessBridge.vcString(projectId)
    const name = MainProcessBridge.vcString(branchName)

    if (!id || !name) {
      return Promise.resolve(MainProcessBridge.VC_BAD_REQUEST)
    }

    return switchBranch(id, name, strategy === 'carry' ? 'carry' : 'discard')
  }

  handleEdgeVcPreviewSwitchCarry = (
    _event: IpcMainInvokeEvent,
    projectId: unknown,
    targetBranch: unknown,
  ): Promise<VersionControlResult<unknown>> => {
    const id = MainProcessBridge.vcString(projectId)
    const target = MainProcessBridge.vcString(targetBranch)

    return id && target ? previewSwitchCarry(id, target) : Promise.resolve(MainProcessBridge.VC_BAD_REQUEST)
  }

  handleEdgeVcListCommits = (
    _event: IpcMainInvokeEvent,
    projectId: unknown,
    options: unknown,
  ): Promise<VersionControlResult<unknown>> => {
    const id = MainProcessBridge.vcString(projectId)

    if (!id) {
      return Promise.resolve(MainProcessBridge.VC_BAD_REQUEST)
    }

    const source = MainProcessBridge.vcRecord(options)
    const limit = typeof source.limit === 'number' && Number.isInteger(source.limit) ? source.limit : undefined
    const offset = typeof source.offset === 'number' && Number.isInteger(source.offset) ? source.offset : undefined

    return listCommits(id, { limit, offset, branch: MainProcessBridge.vcString(source.branch) })
  }

  handleEdgeVcCreateCommit = (
    _event: IpcMainInvokeEvent,
    projectId: unknown,
    message: unknown,
    files: unknown,
    branch: unknown,
  ): Promise<VersionControlResult<unknown>> => {
    const id = MainProcessBridge.vcString(projectId)
    const commitMessage = MainProcessBridge.vcString(message)

    if (files !== undefined && MainProcessBridge.vcStringArray(files) === undefined) {
      return Promise.resolve(MainProcessBridge.VC_BAD_REQUEST)
    }

    return id && commitMessage
      ? createCommit(id, commitMessage, MainProcessBridge.vcStringArray(files), MainProcessBridge.vcString(branch))
      : Promise.resolve(MainProcessBridge.VC_BAD_REQUEST)
  }

  handleEdgeVcGetCommitFiles = (
    _event: IpcMainInvokeEvent,
    projectId: unknown,
    hash: unknown,
    branch: unknown,
  ): Promise<VersionControlResult<unknown>> => {
    const id = MainProcessBridge.vcString(projectId)
    const commitHash = MainProcessBridge.vcString(hash)

    return id && commitHash
      ? getCommitFiles(id, commitHash, MainProcessBridge.vcString(branch))
      : Promise.resolve(MainProcessBridge.VC_BAD_REQUEST)
  }

  handleEdgeVcRestoreCommit = (
    _event: IpcMainInvokeEvent,
    projectId: unknown,
    hash: unknown,
    branch: unknown,
  ): Promise<VersionControlResult<unknown>> => {
    const id = MainProcessBridge.vcString(projectId)
    const commitHash = MainProcessBridge.vcString(hash)

    return id && commitHash
      ? restoreCommit(id, commitHash, MainProcessBridge.vcString(branch))
      : Promise.resolve(MainProcessBridge.VC_BAD_REQUEST)
  }

  handleEdgeVcGetChanges = (
    _event: IpcMainInvokeEvent,
    projectId: unknown,
    includeContent: unknown,
  ): Promise<VersionControlResult<unknown>> => {
    const id = MainProcessBridge.vcString(projectId)

    return id ? getChanges(id, includeContent === true) : Promise.resolve(MainProcessBridge.VC_BAD_REQUEST)
  }

  handleEdgeVcDiscardChanges = (
    _event: IpcMainInvokeEvent,
    projectId: unknown,
    files: unknown,
  ): Promise<VersionControlResult<unknown>> => {
    const id = MainProcessBridge.vcString(projectId)

    if (!id) {
      return Promise.resolve(MainProcessBridge.VC_BAD_REQUEST)
    }

    if (files !== undefined && MainProcessBridge.vcStringArray(files) === undefined) {
      return Promise.resolve(MainProcessBridge.VC_BAD_REQUEST)
    }

    return discardChanges(id, MainProcessBridge.vcStringArray(files))
  }

  handleEdgeVcListStashes = (
    _event: IpcMainInvokeEvent,
    projectId: unknown,
  ): Promise<VersionControlResult<unknown>> => {
    const id = MainProcessBridge.vcString(projectId)

    return id ? listStashes(id) : Promise.resolve(MainProcessBridge.VC_BAD_REQUEST)
  }

  handleEdgeVcCreateStash = (
    _event: IpcMainInvokeEvent,
    projectId: unknown,
    message: unknown,
    files: unknown,
  ): Promise<VersionControlResult<unknown>> => {
    const id = MainProcessBridge.vcString(projectId)

    if (files !== undefined && MainProcessBridge.vcStringArray(files) === undefined) {
      return Promise.resolve(MainProcessBridge.VC_BAD_REQUEST)
    }

    return id
      ? createStash(id, MainProcessBridge.vcString(message), MainProcessBridge.vcStringArray(files))
      : Promise.resolve(MainProcessBridge.VC_BAD_REQUEST)
  }

  handleEdgeVcApplyStash = (
    _event: IpcMainInvokeEvent,
    projectId: unknown,
    ref: unknown,
  ): Promise<VersionControlResult<unknown>> => {
    const id = MainProcessBridge.vcString(projectId)
    const stashRef = MainProcessBridge.vcString(ref)

    return id && stashRef ? applyStash(id, stashRef) : Promise.resolve(MainProcessBridge.VC_BAD_REQUEST)
  }

  handleEdgeVcPopStash = (
    _event: IpcMainInvokeEvent,
    projectId: unknown,
    ref: unknown,
  ): Promise<VersionControlResult<unknown>> => {
    const id = MainProcessBridge.vcString(projectId)
    const stashRef = MainProcessBridge.vcString(ref)

    return id && stashRef ? popStash(id, stashRef) : Promise.resolve(MainProcessBridge.VC_BAD_REQUEST)
  }

  handleEdgeVcDropStash = (
    _event: IpcMainInvokeEvent,
    projectId: unknown,
    ref: unknown,
  ): Promise<VersionControlResult<unknown>> => {
    const id = MainProcessBridge.vcString(projectId)
    const stashRef = MainProcessBridge.vcString(ref)

    return id && stashRef ? dropStash(id, stashRef) : Promise.resolve(MainProcessBridge.VC_BAD_REQUEST)
  }

  /** The live streams, by id. Each way a stream ends (finish, fail, abort, window closing) removes its entry. */
  private readonly aiStreams = new Map<string, AiStream>()

  /** Narrows an IPC argument to a request body. */
  private static aiBody(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value))
      : undefined
  }

  /** A count the API will accept, or nothing — never `NaN`, never negative. */
  private static aiCount(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
  }

  private static readonly AI_BAD_REQUEST = {
    ok: false,
    failure: { kind: 'http', status: 400, message: 'The editor made an invalid AI request.' },
  } as const satisfies EdgeAiResult<never>

  handleEdgeAiEntitlements = () => fetchAiEntitlements()

  handleEdgeAiUsage = () => fetchAiUsage()

  handleEdgeAiCredits = () => fetchAiCredits()

  /** Warms the prompt cache and answers the `edge-ai:*` result union. */
  handleEdgeAiWarm = async (): Promise<EdgeAiResult<null>> => {
    await warmAi()

    return { ok: true, data: null }
  }

  /** Telemetry, refused unless the event is one this build knows. */
  handleEdgeAiTelemetry = async (
    _event: IpcMainInvokeEvent,
    name: unknown,
    data: unknown,
  ): Promise<EdgeAiResult<null>> => {
    const telemetryEvent = toAiTelemetryEvent(name)

    if (!telemetryEvent) {
      logger.warn(`Refused an unknown AI telemetry event: ${typeof name === 'string' ? name : `(${typeof name})`}`)

      return MainProcessBridge.AI_BAD_REQUEST
    }

    await sendAiTelemetry(telemetryEvent, MainProcessBridge.vcRecord(data))

    return { ok: true, data: null }
  }

  /** Lists conversations, narrowing every option before it goes into the query. */
  handleEdgeAiConversationsList = (_event: IpcMainInvokeEvent, options: unknown) => {
    const source = MainProcessBridge.vcRecord(options)

    return listConversations({
      projectId: MainProcessBridge.vcString(source.projectId),
      limit: MainProcessBridge.aiCount(source.limit),
      offset: MainProcessBridge.aiCount(source.offset),
    })
  }

  handleEdgeAiConversationsGet = (_event: IpcMainInvokeEvent, conversationId: unknown) => {
    const id = MainProcessBridge.vcString(conversationId)

    return id ? getConversation(id) : Promise.resolve(MainProcessBridge.AI_BAD_REQUEST)
  }

  handleEdgeAiConversationsCreate = (_event: IpcMainInvokeEvent, body: unknown) => {
    const payload = MainProcessBridge.aiBody(body)

    return payload ? createConversation(payload) : Promise.resolve(MainProcessBridge.AI_BAD_REQUEST)
  }

  handleEdgeAiConversationsRename = (_event: IpcMainInvokeEvent, conversationId: unknown, body: unknown) => {
    const id = MainProcessBridge.vcString(conversationId)
    const payload = MainProcessBridge.aiBody(body)

    return id && payload ? renameConversation(id, payload) : Promise.resolve(MainProcessBridge.AI_BAD_REQUEST)
  }

  handleEdgeAiConversationsDelete = (_event: IpcMainInvokeEvent, conversationId: unknown) => {
    const id = MainProcessBridge.vcString(conversationId)

    return id ? deleteConversation(id) : Promise.resolve(MainProcessBridge.AI_BAD_REQUEST)
  }

  /** Opens a stream and answers with the id its events will carry, generated here. */
  handleEdgeAiStreamStart = (event: IpcMainInvokeEvent, params: unknown): EdgeAiResult<{ streamId: string }> => {
    const source = MainProcessBridge.vcRecord(params)
    const kind = source.kind
    const body = MainProcessBridge.aiBody(source.body)

    if ((kind !== 'chat' && kind !== 'completion') || !body) {
      return MainProcessBridge.AI_BAD_REQUEST
    }

    const streamId = randomUUID()
    const sender = event.sender

    this.watchAiSender(sender)

    let handle: AiStreamHandle | null = null
    let cancelled = false

    this.aiStreams.set(streamId, {
      cancel: () => {
        cancelled = true
        handle?.cancel()
      },
      sender,
    })

    const sink: AiStreamSink = {
      onEvent: (event) => this.sendAiStreamEvent(streamId, 'edge-ai:event', { event }),
      onEnd: () => {
        this.sendAiStreamEvent(streamId, 'edge-ai:end', {})
        this.forgetAiStream(streamId)
      },
      onFailure: (failure) => {
        this.sendAiStreamEvent(streamId, 'edge-ai:error', { failure })
        this.forgetAiStream(streamId)
      },
    }

    try {
      handle = kind === 'chat' ? streamAiChat(body, sink) : streamAiCompletion(body, sink)
    } catch (error) {
      this.forgetAiStream(streamId)

      return { ok: false, failure: { kind: 'unreachable', message: getErrorMessage(error) } }
    }

    if (cancelled) {
      handle.cancel()
    }

    return { ok: true, data: { streamId } }
  }

  /**
   * Cancels a stream on the renderer's behalf. An id that is no longer live answers as success, and no event is
   * emitted.
   */
  handleEdgeAiStreamAbort = (_event: IpcMainInvokeEvent, streamId: unknown): EdgeAiResult<null> => {
    const id = MainProcessBridge.vcString(streamId)

    if (!id) {
      return MainProcessBridge.AI_BAD_REQUEST
    }

    this.abortAiStream(id)

    return { ok: true, data: null }
  }

  /** Pushes one event of a live stream to its window. A destroyed target ends the stream. */
  private sendAiStreamEvent(streamId: string, channel: string, payload: Record<string, unknown>) {
    const stream = this.aiStreams.get(streamId)

    if (!stream) {
      return
    }

    if (stream.sender.isDestroyed()) {
      this.abortAiStream(streamId)
      return
    }

    stream.sender.send(channel, { streamId, ...payload })
  }

  private forgetAiStream(streamId: string) {
    this.aiStreams.delete(streamId)
  }

  /** Renderers this bridge is watching; a WeakSet so a closed window's entry goes with it. */
  private readonly watchedAiSenders = new WeakSet<WebContents>()

  /** Aborts a renderer's AI streams when it is destroyed, its process is gone or its main frame navigates. */
  private watchAiSender(sender: WebContents) {
    if (this.watchedAiSenders.has(sender)) {
      return
    }

    this.watchedAiSenders.add(sender)

    const abortAll = () => this.abortAiStreamsFor(sender)

    sender.on('destroyed', abortAll)
    sender.on('render-process-gone', abortAll)
    sender.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) {
        abortAll()
      }
    })
  }

  private abortAiStreamsFor(sender: WebContents) {
    for (const [streamId, stream] of this.aiStreams) {
      if (stream.sender === sender) {
        this.abortAiStream(streamId)
      }
    }
  }

  /** Forget a stream that has NOT finished, cancelling the request it holds open. */
  private abortAiStream(streamId: string) {
    const stream = this.aiStreams.get(streamId)

    if (!stream) {
      return
    }

    this.forgetAiStream(streamId)
    stream.cancel()
  }

  handleCatalogList = async (
    _event: IpcMainInvokeEvent,
    args: ListPublicLibrariesArgs,
  ): Promise<{ success: true; data: ListPublicLibrariesResponse } | { success: false; error: string }> => {
    try {
      const data = await listPublicLibraries(this.catalogTransport, args ?? {})
      return { success: true, data }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  handleCatalogInstallMany = async (_event: IpcMainInvokeEvent, libraries: PublicLibrary[]) => {
    if (!Array.isArray(libraries) || libraries.length === 0) {
      return { results: [] }
    }
    const validLibraries = libraries.filter((row): row is PublicLibrary => PublicLibrarySchema.safeParse(row).success)
    if (validLibraries.length === 0) {
      return { results: [] }
    }
    const batch = await this.libraryManagerModule.installFromCatalog(validLibraries)
    if (batch.results.some((r) => r.success)) {
      this.mainWindow?.webContents.send('libraries:changed')
    }
    return batch
  }
  handleStoreRetrieveRecent = async () => {
    const pathToUserDataFolder = join(app.getPath('userData'), 'User')
    const pathToUserHistoryFolder = join(pathToUserDataFolder, 'History')
    const projectsFilePath = join(pathToUserHistoryFolder, 'projects.json')
    const response = await this.projectService.readProjectHistory(projectsFilePath)
    try {
      return response
    } catch (error) {
      logger.error('Error reading history file: ' + getErrorMessage(error))
      return []
    }
  }

  /** Puts a project on the recent list without reading it (Save As). Refuses the scratch root. */
  handleTrackRecentProject = async (_event: unknown, projectPath: unknown) => {
    if (typeof projectPath !== 'string' || projectPath.trim() === '') {
      return { success: false, error: 'A project path is required to track a project.' }
    }
    if (!isAbsolute(projectPath)) {
      return { success: false, error: 'A project path must be absolute to be tracked.' }
    }
    if (isRetrievedProjectPath(projectPath)) {
      return { success: false, error: 'A retrieved project is not tracked until it has a location.' }
    }
    try {
      await this.projectService.updateProjectHistory(projectPath)
      return { success: true }
    } catch (error) {
      logger.error('Error tracking project in history: ' + getErrorMessage(error))
      return { success: false, error: getErrorMessage(error) }
    }
  }

  /** Drops a project entry from `projects.json` (recent list); disk is untouched. */
  handleRemoveProjectFromRecent = async (_event: unknown, projectPath: string) => {
    try {
      await this.projectService.removeProjectFromHistory(projectPath)
      return { success: true }
    } catch (error) {
      logger.error('Error removing project from history: ' + getErrorMessage(error))
      return { success: false, error: getErrorMessage(error) }
    }
  }

  /** Recursively deletes a project directory and drops it from the recent list; the destructive `fs.rm` is gated by `deleteProject`'s own `project.json` check. */
  handleDeleteProject = async (_event: unknown, projectPath: string) => {
    try {
      return await this.projectService.deleteProject(projectPath)
    } catch (error) {
      logger.error('Error deleting project: ' + getErrorMessage(error))
      return { success: false, error: getErrorMessage(error) }
    }
  }
  handleAppRequestQuit = () => this.quitCoordinator.requestQuit()
  handleAppQuitReady = () => {
    this.quitPromptReady = true
  }
  handleAppQuitUnready = () => {
    this.quitPromptReady = false
  }

  /** Whether the renderer is loaded, alive and listening for the quit prompt. */
  canPromptQuit(): boolean {
    const webContents = this.mainWindow?.webContents
    return this.quitPromptReady && !!webContents && !webContents.isCrashed()
  }
  handleAppQuit = () => this.quitCoordinator.confirmQuit()

  handleRunCompileProgram = (event: IpcMainEvent, args: CompileProgramIpcArgs) => {
    const mainProcessPort = event.ports[0]
    void this.#compileAfterStartupCheck(args, mainProcessPort).catch((error) => {
      mainProcessPort.postMessage({
        logLevel: 'error',
        message: `${getErrorMessage(error)}\nStopping compilation process.`,
      })
      mainProcessPort.postMessage({ closePort: true })
      mainProcessPort.close()
    })
  }

  async #compileAfterStartupCheck(args: CompileProgramIpcArgs, port: MessagePortMain): Promise<void> {
    if (this.startupDependencies.isRunning()) {
      port.postMessage({
        logLevel: 'info',
        message: 'Waiting for the editor to finish installing the Arduino components every build needs...',
      })
      await this.startupDependencies.whenDone()
    }
    await this.compilerModule.compileProgram(args, port, this)
  }

  handleRunDebugCompilation = (event: IpcMainEvent, args: Array<string | PLCProjectData>) => {
    const mainProcessPort = event.ports[0]
    void this.compilerModule.compileForDebugger(args, mainProcessPort, this)
  }

  handleRunCompileLibrary = (event: IpcMainEvent, args: CompileLibraryIpcArgs) => {
    const mainProcessPort = event.ports[0]
    void this.compilerModule.compileLibrary(args, mainProcessPort, this)
  }

  /**
   * Resolves enabled library names to parsed `.stlib` archives (bundled libs always included). Missing names come back
   * for the caller to surface.
   */
  loadEnabledArchives = (enabledNames: string[]): { archives: unknown[]; missing: string[] } =>
    this.libraryManagerModule.loadEnabledArchives(enabledNames)

  handleWindowControlsClose = () => this.mainWindow?.close()
  handleWindowControlsClosed = () => this.mainWindow?.destroy()
  handleWindowControlsHide = () => this.mainWindow?.hide()
  handleWindowControlsMinimize = () => this.mainWindow?.minimize()
  handleWindowControlsMaximize = () => {
    if (this.mainWindow?.isMaximized()) {
      this.mainWindow?.restore()
    } else {
      this.mainWindow?.maximize()
    }
  }
  handleWindowReload = () => {
    this.stopSimulator()

    const contents = this.mainWindow?.webContents

    if (contents) {
      this.abortAiStreamsFor(contents)
    }

    this.reloadConfirmed = true
    contents?.reload()
  }
  handleWindowRebuildMenu = () => {
    void this.menuBuilder.buildMenu().catch((error) => {
      logger.error('Error rebuilding application menu:', error)
    })
  }

  handleWindowProjectOpen = (_event: IpcMainEvent, open: unknown) => {
    if (typeof open !== 'boolean') return
    if (!open) this.currentProjectPath = null
    void this.menuBuilder.setProjectOpen(open).catch((error) => {
      logger.error('Error rebuilding application menu:', error)
    })
  }

  handleWindowDebuggerActive = (_event: IpcMainEvent, active: unknown) => {
    if (typeof active !== 'boolean') return
    void this.menuBuilder.setDebuggerActive(active).catch((error) => {
      logger.error('Error rebuilding application menu:', error)
    })
  }

  handleHardwareGetAvailableCommunicationPorts = async () => this.hardwareModule.getAvailableSerialPorts()
  handleHardwareGetAvailableBoards = async () => this.hardwareModule.getAvailableBoards()
  handleHardwareRefreshCommunicationPorts = async () => this.hardwareModule.getAvailableSerialPorts()
  handleHardwareRefreshAvailableBoards = async () => this.hardwareModule.getAvailableBoards()

  handlePackagesImportFromFile = async () => {
    if (!this.mainWindow) return { success: false, error: 'No main window' }
    const result = await dialog.showOpenDialog(this.mainWindow, {
      title: 'Import Board Package',
      filters: [{ name: 'VPP Package', extensions: ['vpp'] }],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true }
    }
    const importResult = await this.vppDependencies.importPackage(result.filePaths[0], this.sendPackageInstallProgress)
    if (importResult.success) {
      this.mainWindow.webContents.send('packages:boards-updated')
    }
    return importResult
  }
  handlePackagesInstallFromUrl = async (
    _event: IpcMainInvokeEvent,
    args: { packageId: string; version: string; downloadUrl: string },
  ) => {
    const { packageId, version, downloadUrl } = args
    let tempPath: string | null = null
    try {
      const response = await fetch(downloadUrl)
      if (!response.ok) {
        return {
          success: false,
          error: `Download failed: ${response.status} ${response.statusText}`,
        }
      }
      const buffer = new Uint8Array(await response.arrayBuffer())
      tempPath = join(app.getPath('temp'), `openplc-vpp-${packageId}-${version}-${randomUUID()}.vpp`)
      await writeFile(tempPath, buffer)
      const importResult = await this.vppDependencies.importPackage(tempPath, this.sendPackageInstallProgress)
      if (importResult.success) {
        this.mainWindow?.webContents.send('packages:boards-updated')
      }
      return importResult
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    } finally {
      if (tempPath) {
        await unlink(tempPath).catch(() => {})
      }
    }
  }
  handlePackagesListInstalled = async () => this.packageManagerModule.listInstalled()
  handlePackagesUninstall = async (_event: IpcMainInvokeEvent, packageId: string) => {
    const result = await this.vppDependencies.uninstall(packageId, this.sendPackageInstallProgress)
    if (result.success) {
      this.mainWindow?.webContents.send('packages:boards-updated')
    }
    return result
  }
  handlePackagesReinstall = async (_event: IpcMainInvokeEvent, packageId: string) =>
    this.vppDependencies.reinstall(packageId, this.sendPackageInstallProgress)
  handlePackagesCancelInstall = () => this.vppDependencies.cancel()
  handlePackagesTakeStartupNotices = () => this.startupDependencies.takeNotices()
  sendPackageInstallProgress = (progress: PackageInstallProgress) => {
    this.mainWindow?.webContents.send('packages:install-progress', progress)
  }
  // Re-verify installed VPP signatures and return the ids removed, notifying the renderer when any was dropped.
  handlePackagesVerifySignatures = async (): Promise<string[]> => {
    const removed = this.packageManagerModule.verifyInstalledSignatures()
    if (removed.length > 0) {
      this.mainWindow?.webContents.send('packages:boards-updated')
    }
    return removed
  }
  handlePackagesGetManifest = async (_event: IpcMainInvokeEvent, packageId: string) =>
    this.packageManagerModule.getInstalledPackageManifest(packageId)

  handlePackagesGetPin = async (_event: IpcMainInvokeEvent, packageId: string) =>
    this.packageManagerModule.getPackagePin(packageId)

  handleWasmToolchainCompile = (_event: IpcMainInvokeEvent, request: unknown): Promise<WasmCompileResult> =>
    getDesktopWasmCompileService().compileRequest(request)

  handleUtilGetPreviewImage = async (_event: IpcMainInvokeEvent, image: string, packagePath?: string) =>
    this.hardwareModule.getBoardImagePreview(image, packagePath)
  handleUtilLog = (_: IpcMainEvent, { level, message }: { level: 'info' | 'error'; message: string }) => {
    logger[level](message)
  }
  handleReadDebugFile = async (_event: IpcMainInvokeEvent, projectPath: string, boardTarget: string) => {
    try {
      const fs = await import('fs/promises')
      const path = await import('path')

      if (path.isAbsolute(boardTarget) || boardTarget.includes('..') || boardTarget.includes(path.sep)) {
        return { success: false, error: 'Invalid board target' }
      }

      const debugMapPath = path.resolve(
        resolveBuildWorkspace(projectPath),
        'build',
        boardTarget,
        'src',
        'debug-map.json',
      )
      const content = await fs.readFile(debugMapPath, 'utf-8')
      return { success: true, content }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to read debug-map.json',
      }
    }
  }

  /** Confirms the target is running the program just built, over the held device link or runtime v4's own WebSocket. */
  handleDebuggerVerifyMd5 = async (_event: IpcMainInvokeEvent, expectedMd5: string): Promise<Md5VerifyReply> => {
    try {
      return await this.withDebugChannel<Md5VerifyReply>(
        'verify md5',
        async (client) => {
          const probe = await client.getMd5Hash()
          return {
            success: true,
            match: matchesMd5(probe.md5, expectedMd5),
            targetMd5: probe.md5,
            targetEndian: probe.targetEndian,
          }
        },
        (reason) => ({ success: false, error: reason.error }),
      )
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during MD5 verification',
      }
    }
  }

  /**
   * FC 0x4b run/stop for a baremetal target, over the held device link. State is read from the status poll (FC 0x46).
   */
  handleDebuggerPlcControl = async (_event: IpcMainInvokeEvent, action: 'run' | 'stop'): Promise<PlcControlResult> => {
    this.traceDeviceLink(`run/stop: ${action} requested`)

    const restAddress = this.deviceSession.getRestAddress()
    if (restAddress !== null) return this.restSetPlcState(restAddress, action)

    const link = this.requireControl('run/stop')
    if ('error' in link) return { success: false, error: link.error }

    const target = action === 'run' ? PlcRuntimeState.RUNNING : PlcRuntimeState.STOPPED
    try {
      return await link.client.setPlcState(target)
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during PLC control request',
      }
    }
  }

  /** Run/stop over a REST control channel, through `RuntimeApiClient`. */
  private restSetPlcState = (address: string, action: 'run' | 'stop'): Promise<PlcControlResult> =>
    this.runtimeApi.setPlcState(address, action)

  handleDebuggerGetVariablesList = async (
    _event: IpcMainInvokeEvent,
    variableIndexes: number[],
  ): Promise<{
    success: boolean
    tick?: number
    lastIndex?: number
    data?: number[]
    error?: string
    needsReconnect?: boolean
  }> => {
    if (this.debuggerConnectionType === null) {
      return { success: false, error: 'Debugger not connected' }
    }

    try {
      return await this.withDebugChannel(
        'read variables',
        async (client) => {
          const result = await client.getVariablesList(variableIndexes)
          if (result.success && result.data) {
            this.deviceSession.noteTraffic()
            return { success: true, tick: result.tick, lastIndex: result.lastIndex, data: Array.from(result.data) }
          }
          return { success: false, error: result.error }
        },
        (reason) => ({ success: false, error: reason.error, needsReconnect: true }),
      )
    } catch (error) {
      return { success: false, error: getErrorMessage(error), needsReconnect: true }
    }
  }

  handleReadProgramStMd5 = async (
    _event: IpcMainInvokeEvent,
    projectPath: string,
    boardTarget: string,
  ): Promise<{ success: boolean; md5?: string; error?: string }> => {
    try {
      const fs = await import('fs/promises')
      const path = await import('path')

      if (path.isAbsolute(boardTarget) || boardTarget.includes('..') || boardTarget.includes(path.sep)) {
        return { success: false, error: 'Invalid board target' }
      }

      const debugMapPath = path.resolve(
        resolveBuildWorkspace(projectPath),
        'build',
        boardTarget,
        'src',
        'debug-map.json',
      )
      const raw = await fs.readFile(debugMapPath, 'utf-8')
      const parsed = JSON.parse(raw) as { md5?: unknown }

      if (typeof parsed.md5 !== 'string' || !/^[a-fA-F0-9]{32}$/.test(parsed.md5)) {
        return { success: false, error: 'debug-map.json is missing a valid md5 field' }
      }
      return { success: true, md5: parsed.md5 }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to read debug-map.json',
      }
    }
  }

  /** Reads the run/stop state over an already-open client and pushes it to the renderer, throttled. */
  private plcStatePushedAt = 0

  private async pushPlcState(
    client: { getStatus?: () => Promise<DebugStatusResult> },
    port: string,
    minIntervalMs = 2000,
  ): Promise<void> {
    if (!client.getStatus) return
    const now = Date.now()
    if (now - this.plcStatePushedAt < minIntervalMs) return
    this.plcStatePushedAt = now

    const r = await client.getStatus()
    if (!r.success) return
    this.mainWindow?.webContents?.send('device:plc-state', {
      port,
      plcState: r.plcState,
      switchPosition: r.switchPosition,
    })
  }

  /** Opens the debug session: a Modbus target uses the held device link, and runtime v4 opens its own WebSocket. */
  handleDebuggerConnect = async (_event: IpcMainInvokeEvent): Promise<{ success: boolean; error?: string }> => {
    try {
      const channel = await this.requireDebug('debug session')
      if ('error' in channel) return { success: false, error: channel.error }

      this.debuggerConnectionType = this.deviceSession.getLink()?.transport ?? 'tcp'
      return { success: true }
    } catch (error) {
      this.debuggerConnectionType = null
      return { success: false, error: getErrorMessage(error) }
    }
  }

  /** Stops a debug session by releasing the debug channel. The connection session stays open. */
  handleDebuggerDisconnect = (_event: IpcMainInvokeEvent): Promise<{ success: boolean }> => {
    this.deviceSession.releaseDebugChannel('debug session')
    this.debuggerConnectionType = null
    return Promise.resolve({ success: true })
  }

  /** Push a link state change to the renderer. */
  private emitDeviceLinkStatus(status: DeviceLinkStatus): void {
    if (status.status !== 'connecting') {
      this.traceDeviceLink(
        `status -> ${status.status}${status.descriptor ? ` (${status.transport ?? '?'} ${status.descriptor})` : ''}${
          status.reason ? ` [${status.reason}]` : ''
        }`,
      )
    }
    this.mainWindow?.webContents?.send('device:connection-status', status)
  }

  /** Diagnostic trace for the device connection, written to the log file and the renderer console. */
  private traceDeviceLink(message: string): void {
    logger.info(`[link] ${message}`)
    this.mainWindow?.webContents?.send('device:link-log', message)
  }

  private toDeviceLinkCandidates = (
    configs: DebugConnectionConfig[],
    opts: { probeBaudRates?: boolean } = {},
  ): DeviceLinkCandidate[] => toDeviceLinkCandidates(configs, opts, this.debugChannelDeps)

  /** Dependencies of the debug channel factory, including the simulator's in-process serial port. */
  private readonly debugChannelDeps = {
    createVirtualSerialPort: () => new VirtualSerialPort(this.simulatorModule),
    // Reads the token from the token manager at open time.
    getToken: () => this.runtimeApi.tokens.getToken(),
  }
  /** Consume the classification the last verified candidate produced. */
  private takeDeviceLinkProbe(): DeviceProbeOutcome | null {
    const probe = this.deviceLinkProbe
    this.deviceLinkProbe = null
    return probe
  }

  /**
   * Establishes a session with a Runtime v3/v4: control over REST, debug over the channel its board declares, described
   * here and not opened.
   */
  handleOpenRuntimeSession = (
    _event: IpcMainInvokeEvent,
    params: { address: string; debug: DebugConnectionConfig },
  ): Promise<{ success: boolean; error?: string }> => {
    const candidate = this.toDebugCandidate(params.debug)
    if (!candidate) {
      return Promise.resolve({
        success: false,
        error: `This target declares a debug channel this build cannot open: ${params.debug.connectionType}`,
      })
    }
    this.deviceSession.openRestSession({ address: params.address, debugChannel: candidate })
    this.debuggerConnectionType = params.debug.connectionType
    return Promise.resolve({ success: true })
  }

  /** Close a REST-controlled session (the user logged out / disconnected). */
  handleCloseRuntimeSession = (_event: IpcMainInvokeEvent): Promise<{ success: boolean }> => {
    if (this.deviceSession.getRestAddress() !== null) {
      this.deviceSession.close()
      this.debuggerConnectionType = null
    }
    return Promise.resolve({ success: true })
  }
  private toDebugCandidate = (config: DebugConnectionConfig): DeviceDebugCandidate | null =>
    toDebugCandidate(config, this.debugChannelDeps)

  /**
   * Runs the connect-time classification on a freshly opened candidate and keeps its verdict. Only
   * `connected-with-firmware` keeps a candidate.
   */
  private async verifyDeviceCandidate(
    client: DeviceModbusTransport,
    candidate: DeviceLinkCandidate,
    context: { isLastCandidate: boolean },
  ): Promise<boolean> {
    if (candidate.transport === 'simulator') {
      for (let attempt = 0; attempt < MainProcessBridge.SIMULATOR_PROBE_ATTEMPTS; attempt += 1) {
        try {
          if (await this.probeDeviceLink(client)) return true
        } catch {
          // Not up yet — fall through to the wait below.
        }
        await new Promise((resolve) => setTimeout(resolve, MainProcessBridge.SIMULATOR_PROBE_INTERVAL_MS))
      }
      return false
    }

    const isPatient = !candidate.speculative && (candidate.patient === true || context.isLastCandidate)
    const deviceIdProbe = candidate.speculative
      ? SPECULATIVE_DEVICE_ID_PROBE
      : isPatient
        ? PATIENT_DEVICE_ID_PROBE
        : QUICK_DEVICE_ID_PROBE
    const result = await classifyDeviceLink(client, { deviceIdProbe })
    this.deviceLinkProbe = result
    if (result.status !== 'connected-with-firmware') {
      this.traceDeviceLink(
        `  ${candidate.descriptor}: "${result.status}" after up to ${deviceIdProbe.attempts} id read(s)` +
          `${candidate.speculative ? ' (baud guess)' : isPatient ? ' (last configured endpoint, was patient)' : ''}` +
          `${result.error ? ` — ${result.error}` : ''}`,
      )
      return false
    }
    await this.pushPlcState(client, candidate.descriptor, 0)
    return true
  }

  /** Per-tick liveness read and baremetal run/stop poll, using the status read (FC 0x46). */
  private async probeDeviceLink(client: DeviceModbusTransport): Promise<boolean> {
    const descriptor = this.deviceSession.getLink()?.descriptor ?? ''
    if (client.getStatus) {
      const status = await client.getStatus()
      if (!status.success) return false
      this.plcStatePushedAt = 0
      await this.pushPlcState(client, descriptor, 0)
      return true
    }
    return (await client.getDeviceId()).success
  }

  /**
   * Releases the link if it holds `port` (the handoff before an upload takes the same
   * serial port); a Modbus TCP link is left alone. Returns whether anything was released.
   */
  handleDeviceReleaseSerialPort = async (
    _event: IpcMainInvokeEvent,
    port: string | null | undefined,
  ): Promise<{ released: boolean }> => {
    return { released: this.deviceSession.releaseSerialPort(port) }
  }

  /** The CONTROL channel's client (run/stop, status). */
  private deviceClient(): DeviceModbusTransport | null {
    return this.deviceSession.getClient()
  }

  /**
   * The channel for this operation family, or why there isn't one. A shared session's debug channel is its control
   * channel.
   */
  private requireControl(what: string): { client: DeviceModbusTransport } | ChannelUnavailable {
    const client = this.deviceClient()
    if (!client) return this.explainMissingChannel(what)
    this.traceChannelUse(what, 'control')
    return { client }
  }

  /**
   * The debug channel, opening it if this session's debug medium is its own. A holder
   * acquired here MUST be released or the channel never closes — per-command callers
   * use `withDebugChannel`, which releases in a `finally`.
   */
  private async requireDebug(holder: string): Promise<{ client: DeviceDebugChannel } | ChannelUnavailable> {
    const what = holder.split('#')[0]
    const acquired = await this.deviceSession.acquireDebugChannel(holder)
    if ('error' in acquired) {
      if (!this.deviceSession.isConnected()) return this.explainMissingChannel(what)
      this.traceDeviceLink(`${what}: debug channel unavailable — ${acquired.error}`)
      return { error: acquired.error, needsReconnect: true }
    }
    this.traceChannelUse(what, 'debug')
    return acquired
  }

  /**
   * Runs one command over the debug channel and releases it afterwards. Safe for baremetal, where `releaseDebugChannel`
   * is a no-op.
   */
  /** Monotonic suffix for per-command debug holder keys. */
  private debugHolderSeq = 0

  private async withDebugChannel<T>(
    what: string,
    run: (client: DeviceDebugChannel) => Promise<T>,
    onUnavailable: (reason: ChannelUnavailable) => T,
  ): Promise<T> {
    const holder = `${what}#${++this.debugHolderSeq}`
    const acquired = await this.requireDebug(holder)
    if ('error' in acquired) return onUnavailable(acquired)
    try {
      return await run(acquired.client)
    } finally {
      this.deviceSession.releaseDebugChannel(holder)
    }
  }

  /** Which channel served which command, logged once per distinct combination. */
  private tracedChannelUses = new Set<string>()

  private traceChannelUse(what: string, family: 'control' | 'debug'): void {
    const link = this.deviceSession.getLink()
    const endpoint = `${link?.transport ?? '?'} ${link?.descriptor ?? '?'}`
    const key = `${what}|${family}|${endpoint}`
    if (this.tracedChannelUses.has(key)) return
    this.tracedChannelUses.add(key)
    this.traceDeviceLink(`${what}: using the ${family} channel (${endpoint})`)
  }

  private explainMissingChannel(what: string): ChannelUnavailable {
    if (this.deviceSession.isRecovering()) {
      this.traceDeviceLink(`${what}: refused, the connection is mid-recovery`)
      return { error: 'the connection dropped and is being restored, try again in a moment', needsReconnect: true }
    }
    this.traceDeviceLink(`${what}: refused, nothing is connected`)
    return { error: MainProcessBridge.DEVICE_NOT_CONNECTED, needsReconnect: true }
  }

  /** Probe attempts while the simulator's emulator starts. */
  private static readonly SIMULATOR_PROBE_ATTEMPTS = 10
  private static readonly SIMULATOR_PROBE_INTERVAL_MS = 200

  /** Reported when a command arrives and no session exists. */
  private static readonly DEVICE_NOT_CONNECTED = 'not connected to the target'

  /**
   * Opens and holds the link to a baremetal device, keeping the first of the ordered `candidates` that opens and
   * answers, classified in `verifyDeviceCandidate`.
   */
  handleDeviceConnect = async (
    _event: IpcMainInvokeEvent,
    candidates: DebugConnectionConfig[],
  ): Promise<DeviceProbeOutcome> => {
    this.deviceLinkProbe = null
    this.tracedChannelUses.clear()
    this.traceDeviceLink(
      `connect requested with ${candidates.length} candidate(s): ${
        candidates.map((config) => `${config.connectionType} ${describeDebugEndpoint(config)}`).join(', ') || '(none)'
      }`,
    )

    const linkCandidates = this.toDeviceLinkCandidates(candidates)
    if (linkCandidates.length === 0) {
      this.emitDeviceLinkStatus({ status: 'disconnected' })
      return { status: 'error', error: 'No usable serial or Modbus TCP connection was configured for this device.' }
    }

    const result = await this.deviceSession.open(linkCandidates)
    const probe = this.takeDeviceLinkProbe()
    if (result.ok) return probe ?? { status: 'connected-with-firmware' }

    if (probe && probe.status !== 'connected-with-firmware') return probe
    const tried = result.attempts.map((attempt) => `${describeLinkCandidate(attempt)}: ${attempt.error}`).join('; ')
    return { status: 'no-response', error: tried || 'No connection could be established.' }
  }

  /** Close the held link (user pressed Disconnect). */
  handleDeviceDisconnect = async (): Promise<{ success: boolean }> => {
    this.deviceSession.close()
    this.deviceLinkProbe = null
    this.tracedChannelUses.clear()
    return { success: true }
  }

  /** True while a compound licensing sequence runs over the held client. */
  private deviceLicenseSequenceInFlight = false

  /** The licensing identity, tagged with which kind of value the channel answered. Read fresh on every call. */
  private async readLicenseIdentity(
    client: LicenseChannel,
  ): Promise<{ identity: DeviceIdentity } | { error: string; retryable?: boolean }> {
    const settle = (read: { success: boolean; unsupported?: boolean; error?: string }) => {
      if (read.unsupported) {
        return {
          error:
            'this device has no hardware identity a license can be issued for. ' +
            'Licensed VPPs require hardware that reports a unique identifier.',
          retryable: false,
        } as const
      }
      if (!read.success) return { error: read.error ?? 'the device did not answer the identity read' } as const
      this.deviceSession.noteTraffic()
      return null
    }

    if (client.getDeviceId) {
      const read = await client.getDeviceId()
      const bad = settle(read)
      if (bad) return bad
      return { identity: { kind: 'device-id', deviceId: read.deviceId ?? new Uint8Array(0) } }
    }

    if (client.getAnchor) {
      const read = await client.getAnchor()
      const bad = settle(read)
      if (bad) return bad
      return { identity: { kind: 'anchor', anchor: read.anchor ?? new Uint8Array(0) } }
    }

    return { error: 'This connection cannot read the device identity that licensing needs.', retryable: false }
  }

  /**
   * Run one licensing call over the channel that carries licensing for this session. An unavailable channel answers
   * `check-failed`.
   */
  private async withLicenseChannel(
    what: string,
    run: (client: LicenseChannel) => Promise<DeviceLicenseReport>,
  ): Promise<DeviceLicenseReport> {
    const checkFailed = (error: string): DeviceLicenseReport => ({ outcome: { state: 'check-failed', error } })
    const checkFailedTerminal = (error: string): DeviceLicenseReport => ({
      outcome: { state: 'check-failed', error, retryable: false },
    })

    const control = this.deviceClient()
    if (control) {
      this.traceChannelUse(what, 'control')
      return run(control)
    }

    if (this.deviceSession.getRestAddress() === null) {
      return checkFailed(this.explainMissingChannel(what).error)
    }

    return this.withDebugChannel(
      what,
      async (client) => {
        if (!isLicenseChannel(client)) {
          return checkFailedTerminal('This connection cannot carry the licensing protocol.')
        }
        return run(client)
      },
      (reason) => checkFailed(reason.error),
    )
  }

  /** `device:read-license`: reads and verifies the license the board holds, without contacting the backend. */
  handleDeviceReadLicense = async (
    _event: IpcMainInvokeEvent,
    request: DeviceLicenseRequest,
  ): Promise<DeviceLicenseReport> => {
    return await this.withLicenseChannel('read license', async (client) => {
      try {
        const identity = await this.readLicenseIdentity(client)
        if ('error' in identity) return { outcome: checkFailedOutcome(identity) }

        return await inspectDeviceLicense(client, { ...request, identity: identity.identity })
      } catch (error) {
        return { outcome: { state: 'check-failed', error: getErrorMessage(error) } }
      }
    })
  }

  /** `device:refresh-license`: the full license flow, including the backend recovery. */
  handleDeviceRefreshLicense = async (
    _event: IpcMainInvokeEvent,
    request: DeviceLicenseRequest,
  ): Promise<DeviceLicenseReport> => {
    return await this.withLicenseChannel('refresh license', async (client) => {
      if (this.deviceLicenseSequenceInFlight) {
        return { outcome: { state: 'check-failed', error: 'A license check is already running on this device.' } }
      }
      this.deviceLicenseSequenceInFlight = true

      try {
        const identity = await this.readLicenseIdentity(client)
        if ('error' in identity) return { outcome: checkFailedOutcome(identity) }

        const report = await resolveDeviceLicense(client, { ...request, identity: identity.identity })
        this.deviceSession.noteTraffic()
        return report
      } catch (error) {
        return { outcome: { state: 'check-failed', error: getErrorMessage(error) } }
      } finally {
        this.deviceLicenseSequenceInFlight = false
      }
    })
  }

  handleDebuggerSetVariable = async (
    _event: IpcMainInvokeEvent,
    variableIndex: number,
    force: boolean,
    valueBuffer?: Uint8Array,
  ): Promise<{ success: boolean; error?: string }> => {
    const buffer = valueBuffer ? Buffer.from(valueBuffer) : undefined

    try {
      return await this.withDebugChannel(
        'write variable',
        async (client) => {
          const result = await client.setVariable(variableIndex, force, buffer)
          if (result.success) this.deviceSession.noteTraffic()
          logger.info('[IPC Handler] Modbus setVariable result: ' + JSON.stringify(result))
          return result
        },
        (reason) => ({ success: false, error: reason.error }),
      )
    } catch (error) {
      logger.error('[IPC Handler] Modbus setVariable error: ' + getErrorMessage(error))
      return { success: false, error: getErrorMessage(error) }
    }
  }

  /**
   * Validate that a file path is within the current project root.
   * Resolves symlinks to prevent directory traversal attacks.
   */
  private validateFilePath(filePath: string): boolean {
    if (!this.currentProjectPath) return false
    try {
      const resolved = realpathSync(resolve(filePath))
      const projectRoot = realpathSync(resolve(this.currentProjectPath))
      return resolved.startsWith(projectRoot + sep) || resolved === projectRoot
    } catch {
      const resolved = resolve(filePath)
      const projectRoot = resolve(this.currentProjectPath)
      return resolved.startsWith(projectRoot + sep) || resolved === projectRoot
    }
  }

  /** Stops the simulator and notifies the renderer so it can update UI state. */
  private stopSimulatorAndNotify(): void {
    if (this.simulatorModule.isRunning()) {
      this.stopSimulator()
      this.mainWindow?.webContents.send('simulator:stopped')
    }
  }

  handleEtherCATGetInterfaces = async (
    _event: IpcMainInvokeEvent,
    ipAddress: string,
  ): Promise<{ success: boolean; data?: NetworkInterface[]; error?: string }> => {
    try {
      const result = await this.makeRuntimeApiRequest<{ interfaces: NetworkInterface[] }>(
        ipAddress,
        '/api/discovery/interfaces',
        (data: string) => {
          const response = JSON.parse(data) as { status: string; interfaces: NetworkInterface[] }
          return { interfaces: response.interfaces || [] }
        },
      )
      if (result.success && result.data) {
        return { success: true, data: result.data.interfaces }
      } else {
        return { success: false, error: result.success ? 'No data returned' : result.error }
      }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  handleEtherCATGetStatus = async (
    _event: IpcMainInvokeEvent,
    ipAddress: string,
  ): Promise<{ success: boolean; data?: EtherCATServiceStatusResponse; error?: string }> => {
    try {
      const result = await this.makeRuntimeApiRequest<EtherCATServiceStatusResponse>(
        ipAddress,
        '/api/discovery/ethercat/status',
        (data: string) => {
          const parsed = JSON.parse(data) as unknown
          if (
            !parsed ||
            typeof parsed !== 'object' ||
            typeof (parsed as { available?: unknown }).available !== 'boolean' ||
            typeof (parsed as { message?: unknown }).message !== 'string'
          ) {
            throw new Error('EtherCAT status response did not match expected shape')
          }
          return parsed as EtherCATServiceStatusResponse
        },
      )
      if (result.success && result.data) {
        return { success: true, data: result.data }
      } else {
        return { success: false, error: result.success ? 'No data returned' : result.error }
      }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  handleEtherCATScan = async (
    _event: IpcMainInvokeEvent,
    ipAddress: string,
    scanRequest: EtherCATScanRequest,
  ): Promise<{ success: boolean; data?: EtherCATScanResponse; error?: string }> => {
    try {
      const postData = JSON.stringify({
        plugin: 'ethercat',
        command: 'scan',
        params: { interface: scanRequest.interface, timeout_ms: scanRequest.timeout_ms },
      })
      const scanTimeout = (scanRequest.timeout_ms || 5000) + 10000

      const result = await this.makeRuntimeApiPostRequest(
        ipAddress,
        '/api/plugin-command',
        postData,
        (data: string) => {
          const pluginResponse = JSON.parse(data) as Record<string, unknown>
          if (pluginResponse.error) throw new Error(pluginResponse.error as string)
          return {
            status: (pluginResponse.status as string) ?? 'success',
            devices: (pluginResponse.devices as EtherCATScanResponse['devices']) ?? [],
            message: (pluginResponse.message as string) ?? '',
            scan_time_ms: (pluginResponse.scan_time_ms as number) ?? 0,
            interface: scanRequest.interface,
          } as EtherCATScanResponse
        },
        scanTimeout,
      )

      if (result.success) {
        return { success: true, data: result.data }
      }
      return { success: false, error: result.error }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  /**
   * `POST /api/discovery/ethercat/scan-modules`. Returns the modular coupler's `0xF050` module list as the parsed JSON
   * body.
   */
  handleEtherCATScanModules = async (
    _event: IpcMainInvokeEvent,
    ipAddress: string,
    scanRequest: { busName: string; slavePosition: number; networkInterface?: string },
  ): Promise<{ success: boolean; data?: unknown; error?: string }> => {
    try {
      const postData = JSON.stringify({
        bus_name: scanRequest.busName,
        slave_position: scanRequest.slavePosition,
        ...(scanRequest.networkInterface ? { interface: scanRequest.networkInterface } : {}),
      })
      const result = await this.makeRuntimeApiPostRequest(
        ipAddress,
        '/api/discovery/ethercat/scan-modules',
        postData,
        (data: string): unknown => JSON.parse(data),
        ETHERCAT_SCAN_MODULES_TIMEOUT_MS,
      )

      if (result.success) {
        return { success: true, data: result.data }
      }
      return { success: false, error: result.error }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  handleEtherCATDiagnostics = async (
    _event: IpcMainInvokeEvent,
    ipAddress: string,
    request: { busName: string; slavePosition: number },
  ): Promise<{ success: boolean; data?: unknown; error?: string }> => {
    try {
      const postData = JSON.stringify({
        bus_name: request.busName,
        slave_position: request.slavePosition,
      })
      const result = await this.makeRuntimeApiPostRequest(
        ipAddress,
        '/api/discovery/ethercat/diagnostics',
        postData,
        (data: string): unknown => JSON.parse(data),
        ETHERCAT_DIAGNOSTICS_TIMEOUT_MS,
      )

      if (result.success) {
        return { success: true, data: result.data }
      }
      return { success: false, error: result.error }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  handleEtherCATTest = async (
    _event: IpcMainInvokeEvent,
    ipAddress: string,
    testRequest: EtherCATTestRequest,
  ): Promise<{ success: boolean; data?: EtherCATTestResponse; error?: string }> => {
    try {
      const postData = JSON.stringify(testRequest)
      const testTimeout = (testRequest.timeout_ms || 3000) + 10000

      const result = await this.makeRuntimeApiPostRequest(
        ipAddress,
        '/api/discovery/ethercat/test',
        postData,
        (data: string) => JSON.parse(data) as EtherCATTestResponse,
        testTimeout,
      )

      if (result.success) {
        return { success: true, data: result.data }
      }
      return { success: false, error: result.error }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  handleEtherCATValidate = async (
    _event: IpcMainInvokeEvent,
    ipAddress: string,
    validateRequest: EtherCATValidateRequest,
  ): Promise<{ success: boolean; data?: EtherCATValidateResponse; error?: string }> => {
    try {
      const postData = JSON.stringify(validateRequest)

      const result = await this.makeRuntimeApiPostRequest(
        ipAddress,
        '/api/discovery/ethercat/validate',
        postData,
        (data: string) => JSON.parse(data) as EtherCATValidateResponse,
      )

      if (result.success) {
        return { success: true, data: result.data }
      }
      return { success: false, error: result.error }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  handleEtherCATGetRuntimeStatus = async (
    _event: IpcMainInvokeEvent,
    ipAddress: string,
  ): Promise<{ success: boolean; data?: EtherCATRuntimeStatusResponse; error?: string }> => {
    try {
      const postData = JSON.stringify({
        plugin: 'ethercat',
        command: 'status',
      })

      const result = await this.makeRuntimeApiPostRequest(
        ipAddress,
        '/api/plugin-command',
        postData,
        (data: string) => {
          const pluginResponse = JSON.parse(data) as Record<string, unknown>
          if (pluginResponse.error) throw new Error(pluginResponse.error as string)
          return pluginResponse as unknown as EtherCATRuntimeStatusResponse
        },
      )

      if (result.success) {
        return { success: true, data: result.data }
      }
      return { success: false, error: result.error }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  /** Run a file call and hand its outcome over IPC; the renderer rethrows the message. */
  private async esiFileCall<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
    try {
      return { ok: true, value: await fn() }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  handleESIParse = (_event: IpcMainInvokeEvent, request: EsiParseOp) => runEsiParseOp(request)

  handleESIFileRead = (_event: IpcMainInvokeEvent, projectPath: string, name: string) =>
    this.esiFileCall(() => this.esiFiles.read(projectPath, name))

  handleESIFileWrite = (_event: IpcMainInvokeEvent, projectPath: string, name: string, text: string) =>
    this.esiFileCall(() => this.esiFiles.write(projectPath, name, text))

  handleESIFileRemove = (_event: IpcMainInvokeEvent, projectPath: string, name: string) =>
    this.esiFileCall(() => this.esiFiles.remove(projectPath, name))

  handleESIFileList = (_event: IpcMainInvokeEvent, projectPath: string) =>
    this.esiFileCall(() => this.esiFiles.list(projectPath))

  /** Start the emulator, then open its session. */
  handleSimulatorLoadFirmware = async (
    _event: IpcMainInvokeEvent,
    hexPath: string,
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const fs = await import('fs/promises')
      const hexContent = await fs.readFile(hexPath, 'utf-8')
      this.simulatorModule.loadAndRun(hexContent)

      const opened = await this.deviceSession.open(
        this.toDeviceLinkCandidates([{ connectionType: 'simulator', connectionParams: {} }]),
      )
      if (!opened.ok) {
        this.stopSimulator()
        const reason = opened.attempts.map((attempt) => attempt.error).join('; ')
        return { success: false, error: reason || 'The simulator did not answer its debug protocol' }
      }
      this.debuggerConnectionType = 'simulator'
      return { success: true }
    } catch (error) {
      this.stopSimulator()
      return { success: false, error: getErrorMessage(error) }
    }
  }

  /** Stop the emulator entirely. */
  handleSimulatorStop = (_event: IpcMainInvokeEvent): Promise<{ success: boolean }> => {
    this.stopSimulator()
    return Promise.resolve({ success: true })
  }

  /** Stops the session first, then the emulator. Every stop path routes through here. */
  stopSimulator(): void {
    this.closeSimulatorSession()
    this.simulatorModule.stop()
  }

  /** Close the session if it is the simulator's. No-op for any other target. */
  private closeSimulatorSession(): void {
    if (this.deviceSession.getLink()?.transport !== 'simulator') return
    this.deviceSession.close()
    this.debuggerConnectionType = null
  }

  handleSimulatorIsRunning = (_event: IpcMainInvokeEvent): Promise<boolean> => {
    return Promise.resolve(this.simulatorModule.isRunning())
  }

  handleFileWatchStart = (
    _event: IpcMainInvokeEvent,
    filePath: string,
  ): Promise<{ success: boolean; error?: string }> => {
    if (!this.validateFilePath(filePath)) {
      return Promise.resolve({ success: false, error: 'Path is outside the project directory' })
    }
    return this.fileWatchRegistry.start(filePath)
  }

  handleFileWatchStop = (_event: IpcMainInvokeEvent, filePath: string): { success: boolean; error?: string } => {
    // A registered watcher passed validation when it started; the root may have moved to another project since.
    if (!this.fileWatchRegistry.isWatching(filePath) && !this.validateFilePath(filePath)) {
      return { success: false, error: 'Path is outside the project directory' }
    }
    this.fileWatchRegistry.stop(filePath)
    return { success: true }
  }

  handleFileWatchStopAll = (_event: IpcMainInvokeEvent): { success: boolean } => {
    this.fileWatchRegistry.stopAll()
    return { success: true }
  }

  handleFileReadContent = (
    _event: IpcMainInvokeEvent,
    filePath: string,
  ): Promise<{ success: boolean; content?: string; error?: string }> => {
    if (!this.validateFilePath(filePath)) {
      return Promise.resolve({ success: false, error: 'Path is outside the project directory' })
    }
    return new Promise((res) => {
      readFile(filePath, 'utf-8', (err, content) => {
        if (err) {
          res({ success: false, error: `Failed to read file: ${err.message}` })
        } else {
          res({ success: true, content })
        }
      })
    })
  }

  mainIpcEventHandlers = {
    handleUpdateTheme: (_event: unknown, theme?: 'light' | 'dark' | 'nineties') => {
      const newTheme = theme ?? (nativeTheme.shouldUseDarkColors ? 'light' : 'dark')
      nativeTheme.themeSource = newTheme === 'dark' ? 'dark' : 'light'
      const appStore = this.store as unknown as { set: (key: string, value: string) => void }
      appStore.set('theme', newTheme)
    },
    handleGetTheme: (): 'light' | 'dark' | 'nineties' | null => {
      const appStore = this.store as unknown as { get: (key: string) => unknown }
      const stored = appStore.get('theme')
      return stored === 'light' || stored === 'dark' || stored === 'nineties' ? stored : null
    },
    createPou: () => this.mainWindow?.webContents.send('pou:createPou', { ok: true }),
  }
}

export default MainProcessBridge
