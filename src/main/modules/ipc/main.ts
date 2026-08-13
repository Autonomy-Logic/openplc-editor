import { ESIService } from '@root/backend/editor/ethercat'
import { createDesktopCatalogTransport } from '@root/backend/editor/library-manager/desktop-catalog-transport'
import { getRuntimeHttpsOptions } from '@root/backend/editor/utils/runtime-https-config'
import type {
  DebugStatusResult,
  DeviceDebugChannel,
  DeviceModbusTransport,
  PlcControlResult,
} from '@root/backend/shared/debug/types'
import { parseESIDeviceFull } from '@root/backend/shared/ethercat/esi-parser-main'
import { listPublicLibraries } from '@root/backend/shared/library/public-catalog-client'
import { PlcRuntimeState } from '@root/backend/shared/simulator/types'
import { PLCProjectData } from '@root/backend/shared/types/PLC/open-plc'
import { getErrorMessage } from '@root/frontend/utils/get-error-message'
import { RuntimeLogEntry } from '@root/middleware/shared/ports'
import type { DeviceLicenseReport, DeviceLicenseRequest } from '@root/middleware/shared/ports/device-port'
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
  ListPublicLibrariesArgs,
  ListPublicLibrariesResponse,
  PublicLibrary,
} from '@root/middleware/shared/ports/public-catalog-types'
import type { RuntimeUser, RuntimeUserRole, UpdateUserParams } from '@root/middleware/shared/ports/runtime-port'
import type { DebugConnectionConfig } from '@root/middleware/shared/ports/types'
import { createRuntimeTokenManager } from '@root/middleware/shared/runtime-auth/runtime-token-manager'
import { CreatePouFileProps } from '@root/types/IPC/pou-service'
import { CreateProjectFileProps } from '@root/types/IPC/project-service'
import { randomUUID } from 'crypto'
import dgram from 'dgram'
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { app, dialog, nativeTheme, shell } from 'electron'
import { readFile, realpathSync, stat, statSync, unwatchFile, watchFile } from 'fs'
import { unlink, writeFile } from 'fs/promises'
import type { IncomingHttpHeaders, IncomingMessage } from 'http'
import https from 'https'
import { networkInterfaces } from 'os'
import { join, resolve, sep } from 'path'
import { platform } from 'process'

import { MainIpcModule, MainIpcModuleConstructor } from '../../../backend/editor/contracts/types/modules/ipc/main'
import {
  classifyDeviceLink,
  type DeviceProbeOutcome,
  PATIENT_BOARD_ID_PROBE,
  planBaudAttempts,
  QUICK_BOARD_ID_PROBE,
  SPECULATIVE_BOARD_ID_PROBE,
} from '../../../backend/editor/hardware/device-probe'
import {
  describeLinkCandidate,
  type DeviceDebugCandidate,
  type DeviceLinkCandidate,
  type DeviceLinkStatus,
  DeviceSessionManager,
} from '../../../backend/editor/hardware/device-session-manager'
import {
  buildDeviceModbusTransport,
  modbusTransportKind,
} from '../../../backend/editor/hardware/device-transport-factory'
import { LibraryManagerModule } from '../../../backend/editor/library-manager'
import { inspectDeviceLicense, resolveDeviceLicense } from '../../../backend/editor/license/license-flow'
import { PackageManagerModule } from '../../../backend/editor/package-manager'
import { logger } from '../../../backend/editor/services'
import {
  getOpenProjectPath,
  getPlcopenExportSavePath,
  getPlcopenImportFilePath,
  getProjectPath,
} from '../../../backend/editor/utils'
import { WebSocketDebugTransport } from '../../../backend/shared/debug/websocket-debug-transport'
import { SimulatorModule } from '../../../backend/shared/simulator/simulator-module'
import { VirtualSerialPort } from '../../../backend/shared/simulator/virtual-serial-port'
import { describeDebugEndpoint } from '../../../middleware/shared/utils/debug-endpoint'

/** Why a channel could not be handed out. */
interface ChannelUnavailable {
  error: string
  needsReconnect: true
}

/** Program-identity comparison, case-insensitively — targets report either case. */
function matchesMd5(targetMd5: string, expectedMd5: string): boolean {
  return targetMd5.toLowerCase() === expectedMd5.toLowerCase()
}

/**
 * What `debugger:verify-md5` answers. Named so the success and unavailable paths
 * are typed against ONE shape — inferred separately, the success branch narrowed
 * `success` to the literal `true` and the two stopped being assignable.
 */
interface Md5VerifyReply {
  success: boolean
  match?: boolean
  targetMd5?: string
  targetEndian?: 'le' | 'be'
  error?: string
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
  private registeredHandleChannels: string[] = []
  // ---------------------------------------------------------------------------
  // Talking to a baremetal device
  //
  // ONE session, owned by `deviceSession`, whatever media it runs over: the
  // debugger, run/stop and the status poll all borrow that one client.
  // Nothing else here opens a Modbus client — see `device-link-manager.ts` for
  // why (in short: three owners meant a run/stop command could open a second
  // socket the board would not answer).
  //
  // The runtime-v4 WebSocket is the one transport that is NOT a device link: it
  // is a different protocol to a different kind of target, so it keeps its own
  // client and its own session identity.
  // ---------------------------------------------------------------------------
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
  // Address of the runtime this session is authenticated against. Captured at
  // login so the token authority can re-authenticate against the same device.
  private runtimeIp: string | null = null
  // Single token authority for the editor: owns the access token + credentials
  // and the refresh/retry-on-401 logic, shared byte-for-byte with the web app.
  // Every runtime HTTP call (GET, POST, and the project upload) goes through it,
  // so they all self-heal identically when the 15-min JWT expires.
  private tokens = createRuntimeTokenManager({
    login: async (credentials) => {
      if (!this.runtimeIp) return { success: false, error: 'No runtime address configured' }
      const result = await this.performAuthentication(this.runtimeIp, credentials.username, credentials.password)
      return { success: result.success, token: result.accessToken, error: result.error }
    },
  })
  // Current project root path used to validate file-watcher IPC calls
  private currentProjectPath: string | null = null
  // File watchers for auto-reload functionality (using watchFile for better macOS compatibility)
  private fileWatchers: Map<string, { lastMtime: number }> = new Map()
  // avr8js ATmega2560 emulator instance for the built-in simulator
  private simulatorModule = new SimulatorModule()
  // VPP package manager for board package operations
  private packageManagerModule = new PackageManagerModule()
  // System-wide IEC 61131-3 library pool (bundled + user-installed)
  private libraryManagerModule = new LibraryManagerModule()
  // Shared transport for public-catalog HTTP — re-used by the
  // `catalog:list` handler so the library-manager-module's batch
  // install path and the modal's browse path hit the same env-
  // configured base URL.
  private catalogTransport = createDesktopCatalogTransport()
  // ESI repository service for EtherCAT device descriptions
  private esiService = new ESIService()

  constructor({
    ipcMain,
    mainWindow,
    projectService,
    store,
    menuBuilder,
    pouService,
    compilerModule,
    hardwareModule,
  }: MainIpcModuleConstructor) {
    this.ipcMain = ipcMain
    this.mainWindow = mainWindow
    this.projectService = projectService
    this.store = store
    this.menuBuilder = menuBuilder
    this.pouService = pouService
    this.compilerModule = compilerModule
    this.hardwareModule = hardwareModule

    // When the token authority transparently refreshes an expired token, push
    // the fresh token to the renderer so its store connection flag tracks it.
    this.tokens.onTokenChanged((newToken) => {
      this.mainWindow?.webContents?.send('runtime:token-refreshed', newToken)
    })
  }

  // ===================== RUNTIME API HANDLERS =====================
  private readonly RUNTIME_API_PORT = 8443
  private readonly RUNTIME_CONNECTION_TIMEOUT_MS = 5000 // 5 seconds (important-comment)
  private readonly RUNTIME_LOGIN_TIMEOUT_MS = 15000 // 15 seconds

  /**
   * Low-level HTTP helper that handles data accumulation, timeout, and error handling.
   * Returns the raw status code, response body, and headers for the caller to interpret.
   */
  private httpRequest(options: {
    method: 'GET' | 'POST'
    url: string
    body?: string
    headers?: Record<string, string>
    timeoutMs?: number
  }): Promise<{ statusCode: number; data: string; headers: IncomingHttpHeaders }> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(options.url)
      const reqOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method,
        headers: {
          ...options.headers,
          ...(options.body
            ? {
                'Content-Type': 'application/json',
                'Content-Length': String(Buffer.byteLength(options.body)),
              }
            : {}),
        },
        ...getRuntimeHttpsOptions(),
      }

      const req = https.request(reqOptions as https.RequestOptions, (res: IncomingMessage) => {
        let data = ''
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString()
        })
        res.on('end', () => {
          resolve({ statusCode: res.statusCode ?? 0, data, headers: res.headers })
        })
      })
      req.setTimeout(options.timeoutMs ?? this.RUNTIME_CONNECTION_TIMEOUT_MS, () => {
        req.destroy()
        reject(new Error('Connection timeout'))
      })
      req.on('error', (error: Error) => {
        reject(error)
      })
      if (options.body) {
        req.write(options.body)
      }
      req.end()
    })
  }

  private runtimeUrl(ipAddress: string, endpoint: string): string {
    return `https://${ipAddress}:${this.RUNTIME_API_PORT}${endpoint}`
  }

  handleRuntimeGetUsersInfo = async (_event: IpcMainInvokeEvent, ipAddress: string) => {
    try {
      const res = await this.httpRequest({
        method: 'GET',
        url: this.runtimeUrl(ipAddress, '/api/get-users-info'),
      })
      const runtimeVersion = res.headers['x-openplc-runtime-version'] as string | undefined

      if (res.statusCode === 404) {
        return { hasUsers: false, runtimeVersion }
      } else if (res.statusCode === 200) {
        return { hasUsers: true, runtimeVersion }
      } else {
        return { hasUsers: false, error: res.data || `Unexpected status: ${res.statusCode}`, runtimeVersion }
      }
    } catch (error) {
      return { hasUsers: false, error: getErrorMessage(error) }
    }
  }

  handleRuntimeCreateUser = async (
    _event: IpcMainInvokeEvent,
    ipAddress: string,
    username: string,
    password: string,
    role?: RuntimeUserRole,
  ) => {
    try {
      // `role` is only honoured by the runtime for authenticated (admin) creation;
      // the unauthenticated first-user bootstrap always becomes an admin regardless.
      const body: { username: string; password: string; role?: RuntimeUserRole } = { username, password }
      if (role) body.role = role
      const payload = JSON.stringify(body)

      // First-user bootstrap runs before any login (no token yet) and the
      // runtime allows it unauthenticated. Once a session exists this is an
      // admin adding an account, which the runtime requires to be authenticated
      // — route it through the token authority (mutation helper accepts the
      // runtime's 201 Created and refreshes an expired token).
      if (this.tokens.hasToken()) {
        const res = await this.makeRuntimeApiMutation('POST', ipAddress, '/api/create-user', payload)
        return res.success ? { success: true } : { success: false, error: res.error }
      }

      const res = await this.httpRequest({
        method: 'POST',
        url: this.runtimeUrl(ipAddress, '/api/create-user'),
        body: payload,
      })
      if (res.statusCode === 201) return { success: true }
      return { success: false, error: res.data }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  }

  handleRuntimeListUsers = async (_event: IpcMainInvokeEvent, ipAddress: string) => {
    const res = await this.makeRuntimeApiRequest<RuntimeUser[]>(ipAddress, '/api/get-users-info', (data) => {
      // With a valid admin token this is a user array; without one the runtime
      // answers the existence-only {"msg":"Users found"} object — coerce that
      // (or any non-array) to an empty list so the caller never gets a non-array.
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
    // The runtime expects snake_case `current_password`; only send provided fields.
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

  private async performAuthentication(
    ipAddress: string,
    username: string,
    password: string,
  ): Promise<{ success: boolean; accessToken?: string; error?: string }> {
    try {
      const res = await this.httpRequest({
        method: 'POST',
        url: this.runtimeUrl(ipAddress, '/api/login'),
        body: JSON.stringify({ username, password }),
        timeoutMs: this.RUNTIME_LOGIN_TIMEOUT_MS,
      })
      if (res.statusCode === 200) {
        try {
          const response = JSON.parse(res.data) as { access_token: string }
          return { success: true, accessToken: response.access_token }
        } catch {
          return { success: false, error: 'Invalid response format' }
        }
      }
      return { success: false, error: res.data }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  }

  handleRuntimeLogin = async (_event: IpcMainInvokeEvent, ipAddress: string, username: string, password: string) => {
    const result = await this.performAuthentication(ipAddress, username, password)
    if (result.success && result.accessToken) {
      // Hand the session to the token authority so it can transparently
      // re-authenticate against this device when the token expires.
      this.runtimeIp = ipAddress
      this.tokens.setSession(result.accessToken, { username, password })
    }
    return result
  }

  private isTokenExpiredError(statusCode: number | undefined, errorMessage: string): boolean {
    if (statusCode === 401 || statusCode === 403) {
      return true
    }
    const lowerError = errorMessage.toLowerCase()
    return (
      lowerError.includes('unauthorized') ||
      lowerError.includes('token') ||
      lowerError.includes('expired') ||
      lowerError.includes('invalid token')
    )
  }

  private parseApiResponse<T>(
    data: string,
    responseParser?: (data: string) => T,
  ): { success: true; data?: T } | { success: false; error: string } {
    if (responseParser) {
      try {
        return { success: true, data: responseParser(data) }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Invalid response format' }
      }
    }
    return { success: true }
  }

  async makeRuntimeApiRequest<T = void>(
    ipAddress: string,
    endpoint: string,
    responseParser?: (data: string) => T,
  ): Promise<{ success: true; data?: T } | { success: false; error: string }> {
    // The token authority owns the live token + refresh.
    type Raw = { success: true; data?: T } | { success: false; error: string; statusCode?: number }
    const url = this.runtimeUrl(ipAddress, endpoint)
    const result = await this.tokens.withAuth<Raw>(
      async (token) => {
        try {
          const res = await this.httpRequest({ method: 'GET', url, headers: { Authorization: `Bearer ${token}` } })
          if (res.statusCode === 200) return this.parseApiResponse(res.data, responseParser)
          return { success: false, error: res.data, statusCode: res.statusCode }
        } catch (error) {
          return { success: false, error: getErrorMessage(error) }
        }
      },
      (r) => !r.success && this.isTokenExpiredError(r.statusCode, r.error),
    )
    return result.success ? result : { success: false, error: result.error }
  }

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

  /**
   * Make an authenticated POST request to the runtime API with automatic token refresh on 401/403.
   */
  makeRuntimeApiPostRequest<T>(
    ipAddress: string,
    endpoint: string,
    body: string,
    responseParser: (data: string) => T,
    timeoutMs?: number,
  ): Promise<{ success: true; data: T } | { success: false; error: string }> {
    // Token + refresh owned by the authority.
    type PostResult = { success: true; data: T } | { success: false; error: string; statusCode?: number }

    const doRequest = (token: string): Promise<PostResult> => {
      return new Promise((resolve) => {
        const req = https.request(
          {
            hostname: ipAddress,
            port: this.RUNTIME_API_PORT,
            path: endpoint,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body),
              Authorization: `Bearer ${token}`,
            },
            ...getRuntimeHttpsOptions(),
          },
          (res: IncomingMessage) => {
            let data = ''
            res.on('data', (chunk: Buffer) => {
              data += chunk.toString()
            })
            res.on('end', () => {
              if (res.statusCode === 200) {
                try {
                  resolve({ success: true, data: responseParser(data) })
                } catch (err) {
                  resolve({ success: false, error: err instanceof Error ? err.message : 'Invalid response format' })
                }
              } else {
                // Propagate HTTP status so the caller can detect 401/403 for
                // token-refresh without relying on brittle message parsing.
                resolve({
                  success: false,
                  error: data || `Unexpected status: ${res.statusCode}`,
                  statusCode: res.statusCode,
                })
              }
            })
          },
        )
        req.setTimeout(timeoutMs ?? this.RUNTIME_CONNECTION_TIMEOUT_MS, () => {
          req.destroy()
          resolve({ success: false, error: 'Connection timeout' })
        })
        req.on('error', (error: Error) => {
          resolve({ success: false, error: error.message })
        })
        req.write(body)
        req.end()
      })
    }

    const stripStatus = (r: PostResult): { success: true; data: T } | { success: false; error: string } =>
      r.success ? r : { success: false, error: r.error }

    return this.tokens
      .withAuth<PostResult>(
        (token) => doRequest(token),
        (r) => !r.success && this.isTokenExpiredError(r.statusCode, r.error),
      )
      .then(stripStatus)
  }

  /**
   * Authenticated PUT/DELETE against the runtime API, going through the token
   * authority. Unlike the GET/POST helpers this retries only on 401 (a genuine
   * expired token): the user-management endpoints use 403 as a legitimate
   * business response (e.g. "current password incorrect", "admin required"),
   * so retrying on 403 would trigger a pointless re-authentication. Any 2xx is
   * success; the raw body is returned so callers can surface error messages.
   */
  private makeRuntimeApiMutation(
    method: 'POST' | 'PUT' | 'DELETE',
    ipAddress: string,
    endpoint: string,
    body?: string,
  ): Promise<{ success: true; data: string } | { success: false; error: string }> {
    type R = { success: true; data: string } | { success: false; error: string; statusCode?: number }

    const doRequest = (token: string): Promise<R> =>
      new Promise((resolve) => {
        const headers: Record<string, string | number> = { Authorization: `Bearer ${token}` }
        if (body !== undefined) {
          headers['Content-Type'] = 'application/json'
          headers['Content-Length'] = Buffer.byteLength(body)
        }
        const req = https.request(
          {
            hostname: ipAddress,
            port: this.RUNTIME_API_PORT,
            path: endpoint,
            method,
            headers,
            ...getRuntimeHttpsOptions(),
          },
          (res: IncomingMessage) => {
            let data = ''
            res.on('data', (chunk: Buffer) => {
              data += chunk.toString()
            })
            res.on('end', () => {
              const statusCode = res.statusCode ?? 0
              if (statusCode >= 200 && statusCode < 300) {
                resolve({ success: true, data })
              } else {
                resolve({ success: false, error: data || `Unexpected status: ${statusCode}`, statusCode })
              }
            })
          },
        )
        req.setTimeout(this.RUNTIME_CONNECTION_TIMEOUT_MS, () => {
          req.destroy()
          resolve({ success: false, error: 'Connection timeout' })
        })
        req.on('error', (error: Error) => {
          resolve({ success: false, error: error.message })
        })
        if (body !== undefined) req.write(body)
        req.end()
      })

    return this.tokens
      .withAuth<R>(
        (token) => doRequest(token),
        (r) => !r.success && r.statusCode === 401,
      )
      .then((r) => (r.success ? { success: true, data: r.data } : { success: false, error: r.error }))
  }

  /**
   * Upload a compiled program (multipart) to the runtime, going through the
   * token authority so an expired token is transparently refreshed and the
   * upload retried — the same self-healing every other runtime call gets. This
   * is the path that previously had no refresh, so a long session's upload 401'd
   * while status polling kept working.
   */
  makeRuntimeApiUpload(opts: {
    ipAddress: string
    fileBuffer: Buffer
    filename: string
    contentType: string
    cleanBuild: boolean
    onUploadAccepted?: (responseBody: string) => void
  }): Promise<{ success: true; data: string } | { success: false; error: string }> {
    type UploadResult = { success: true; data: string } | { success: false; error: string; statusCode?: number }
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2)
    const header = Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${opts.filename}"\r\n` +
        `Content-Type: ${opts.contentType}\r\n\r\n`,
    )
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`)
    const reqBody = Buffer.concat([header, opts.fileBuffer, footer] as unknown as ReadonlyArray<Uint8Array>)
    const path = opts.cleanBuild ? '/api/upload-file?clean=1' : '/api/upload-file'

    const doRequest = (token: string): Promise<UploadResult> =>
      new Promise((resolve) => {
        const req = https.request(
          {
            hostname: opts.ipAddress,
            port: this.RUNTIME_API_PORT,
            path,
            method: 'POST',
            headers: {
              'Content-Type': `multipart/form-data; boundary=${boundary}`,
              'Content-Length': reqBody.length,
              Authorization: `Bearer ${token}`,
            },
            ...getRuntimeHttpsOptions(),
          } as https.RequestOptions,
          (res: IncomingMessage) => {
            let data = ''
            res.on('data', (chunk: Buffer) => {
              data += chunk.toString()
            })
            res.on('end', () => {
              if (res.statusCode === 200) resolve({ success: true, data })
              else resolve({ success: false, error: data || `HTTP ${res.statusCode}`, statusCode: res.statusCode })
            })
          },
        )
        req.setTimeout(300_000, () => {
          req.destroy()
          resolve({ success: false, error: 'Upload request timed out after 5 minutes' })
        })
        req.on('error', (err: Error) => resolve({ success: false, error: err.message }))
        req.write(reqBody)
        req.end()
      })

    return this.tokens
      .withAuth<UploadResult>(
        (token) => doRequest(token),
        (r) => !r.success && this.isTokenExpiredError(r.statusCode, r.error),
      )
      .then((result) => {
        if (result.success) {
          opts.onUploadAccepted?.(result.data)
          return { success: true as const, data: result.data }
        }
        return { success: false as const, error: result.error }
      })
  }

  handleRuntimeGetStatus = async (_event: IpcMainInvokeEvent, ipAddress: string, includeStats?: boolean) => {
    try {
      // Build the endpoint path with optional include_stats query parameter
      const endpoint = includeStats ? '/api/status?include_stats=true' : '/api/status'

      // strucpp+ runtimes report per-task stats: timing_stats = { tasks: [...] }.
      // Pre-strucpp runtimes report a flat object: { scan_count, scan_time_min, ... }.
      // Both shapes can carry an optional plugin_stats map populated by
      // get_stats hooks on loaded native/VPP plugins. Accept either
      // task-shape and forward plugin_stats verbatim so the renderer
      // stays alive when pointed at an older PLC and gets new plugin
      // metrics without IPC churn.
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
        // Run/stop mode-switch position. Absent on runtimes older than the
        // run/stop interface — treat undefined as "no gating".
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
          // Legacy flat shape — wrap into a single-entry tasks array so
          // the renderer can iterate uniformly. Forward plugin_stats
          // verbatim if it was attached at the top level.
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
    this.runtimeIp = null
    return { success: true }
  }

  // ===================== RUNTIME LAN DISCOVERY =====================
  private readonly DISCOVERY_PORT = 33333
  private readonly DISCOVERY_MAGIC = 'OPENPLC_DISCOVER_V1'
  private readonly DISCOVERY_DEFAULT_DURATION_MS = 3000

  /**
   * Compute the directed broadcast address for an IPv4 interface
   * given its address and netmask in dotted-quad form.  Returns
   * `255.255.255.255` for /32 or otherwise-degenerate masks where a
   * meaningful broadcast cannot be derived.
   */
  private computeBroadcastAddress(address: string, netmask: string): string {
    const toOctets = (s: string): number[] | null => {
      const parts = s.split('.').map((p) => Number(p))
      if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
        return null
      }
      return parts
    }
    const addr = toOctets(address)
    const mask = toOctets(netmask)
    if (!addr || !mask) {
      return '255.255.255.255'
    }
    const broadcast = addr.map((octet, i) => (octet & mask[i]) | (~mask[i] & 0xff))
    return broadcast.join('.')
  }

  handleRuntimeDiscoverDevices = (
    event: IpcMainInvokeEvent,
    opts?: { durationMs?: number },
  ): Promise<{
    success: boolean
    devices?: Array<{ ipAddress: string; hostname: string; runtimeVersion: string; apiPort: number }>
    error?: string
  }> => {
    const duration = Math.max(500, Math.min(10000, opts?.durationMs ?? this.DISCOVERY_DEFAULT_DURATION_MS))
    const senderWebContents = event.sender

    return new Promise((resolveOuter) => {
      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true })
      // Dedup by source IP; last reply wins so a runtime updating its
      // hostname mid-scan still settles on fresh data.
      const discovered = new Map<
        string,
        { ipAddress: string; hostname: string; runtimeVersion: string; apiPort: number }
      >()
      let settled = false
      let timer: NodeJS.Timeout | null = null

      const finish = (err?: Error) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        try {
          sock.close()
        } catch {
          /* socket already closed */
        }
        if (err) {
          resolveOuter({ success: false, error: err.message })
        } else {
          resolveOuter({ success: true, devices: Array.from(discovered.values()) })
        }
      }

      sock.on('error', (err) => finish(err))

      sock.on('message', (msg, rinfo) => {
        let parsed: unknown
        try {
          parsed = JSON.parse(msg.toString('utf-8'))
        } catch {
          return
        }
        if (
          typeof parsed !== 'object' ||
          parsed === null ||
          (parsed as { service?: unknown }).service !== 'openplc-runtime'
        ) {
          return
        }
        const p = parsed as {
          runtime_version?: unknown
          hostname?: unknown
          api_port?: unknown
        }
        const device = {
          ipAddress: rinfo.address,
          hostname: typeof p.hostname === 'string' ? p.hostname : '',
          runtimeVersion: typeof p.runtime_version === 'string' ? p.runtime_version : '',
          apiPort: typeof p.api_port === 'number' ? p.api_port : 8443,
        }
        discovered.set(device.ipAddress, device)
        // Stream the live update to the renderer so the modal can
        // append rows as devices come in, instead of waiting for the
        // full timeout.
        if (!senderWebContents.isDestroyed()) {
          senderWebContents.send('runtime:device-discovered', device)
        }
      })

      sock.bind(0, () => {
        try {
          sock.setBroadcast(true)
        } catch (err) {
          finish(err as Error)
          return
        }

        const magic = new Uint8Array(Buffer.from(this.DISCOVERY_MAGIC, 'utf-8'))
        const targets = new Set<string>(['255.255.255.255'])
        const ifaces = networkInterfaces()
        for (const list of Object.values(ifaces)) {
          if (!list) continue
          for (const ifaceInfo of list) {
            if (ifaceInfo.family !== 'IPv4' || ifaceInfo.internal) continue
            const broadcast = this.computeBroadcastAddress(ifaceInfo.address, ifaceInfo.netmask)
            targets.add(broadcast)
          }
        }

        for (const target of targets) {
          sock.send(magic, this.DISCOVERY_PORT, target, (sendErr) => {
            // Per-target send errors are logged but don't abort the
            // scan; some interfaces (e.g. VPN tun adapters) reject
            // broadcast and that's fine.
            if (sendErr) {
              logger.debug(`Discovery send to ${target} failed: ${sendErr.message}`)
            }
          })
        }

        timer = setTimeout(() => finish(), duration)
      })
    })
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

  // ===================== IPC HANDLER REGISTRATION =====================

  /**
   * Register an invoke handler and track the channel for cleanup.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private registerHandle(channel: string, handler: (event: IpcMainInvokeEvent, ...args: any[]) => any) {
    this.registeredHandleChannels.push(channel)
    this.ipcMain.handle(channel, handler)
  }

  /**
   * Remove all previously registered invoke handlers so they can be
   * re-registered with fresh references on macOS window reopen.
   */
  private cleanupHandlers() {
    for (const channel of this.registeredHandleChannels) {
      this.ipcMain.removeHandler(channel)
    }
    this.registeredHandleChannels = []
  }

  setupMainIpcListener() {
    this.cleanupHandlers()

    // Project-related handlers
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

    // Pou-related handlers
    this.registerHandle('pou:create', this.handleCreatePouFile)
    this.registerHandle('pou:delete', this.handleDeletePouFile)
    this.registerHandle('pou:rename', this.handleRenamePouFile)

    // App and system handlers
    this.registerHandle('open-external-link', this.handleOpenExternalLink)
    this.registerHandle('system:get-system-info', this.handleGetSystemInfo)
    this.registerHandle('libraries:load-all', this.handleLibrariesLoadAll)
    this.registerHandle('libraries:list-installed', this.handleLibrariesListInstalled)
    this.registerHandle('libraries:install-from-file', this.handleLibrariesInstallFromFile)
    this.registerHandle('libraries:uninstall', this.handleLibrariesUninstall)
    this.registerHandle('catalog:list', this.handleCatalogList)
    this.registerHandle('catalog:install-many', this.handleCatalogInstallMany)
    this.registerHandle('app:store-retrieve-recent', this.handleStoreRetrieveRecent)
    this.registerHandle('project:remove-from-recent', this.handleRemoveProjectFromRecent)
    this.registerHandle('project:delete', this.handleDeleteProject)
    this.ipcMain.on('app:quit', this.handleAppQuit)
    // this.ipcMain.on('app:reply-if-app-is-closing', (_, shouldQuit) => { ... })

    // Theme and store handlers
    this.ipcMain.on('system:update-theme', this.mainIpcEventHandlers.handleUpdateTheme)
    this.ipcMain.handle('system:get-theme', this.mainIpcEventHandlers.handleGetTheme)
    // this.ipcMain.handle('app:store-get', this.mainIpcEventHandlers.getStoreValue)

    // ===================== COMPILER SERVICE =====================
    // TODO: This handle should be refactored to use MessagePortMain for better performance.
    this.registerHandle('compiler:export-project-xml', this.handleCompilerExportProjectXml)
    this.ipcMain.on('compiler:run-compile-program', this.handleRunCompileProgram)
    this.ipcMain.on('compiler:run-debug-compilation', this.handleRunDebugCompilation)
    this.ipcMain.on('compiler:run-compile-library', this.handleRunCompileLibrary)

    // +++ !! Deprecated: These handlers are outdated and should be removed. +++

    // this.ipcMain.on('compiler:setup-environment', this.handleCompilerSetupEnvironment)
    // this.ipcMain.handle('compiler:create-build-directory', this.handleCompilerCreateBuildDirectory)
    // this.ipcMain.handle('compiler:build-xml-file', this.handleCompilerBuildXmlFile)
    // this.ipcMain.on('compiler:build-st-program', this.handleCompilerBuildStProgram)
    // this.ipcMain.on('compiler:generate-c-files', this.handleCompilerGenerateCFiles)

    // ===================== WINDOW CONTROLS =====================
    this.ipcMain.on('window-controls:close', this.handleWindowControlsClose)
    this.ipcMain.on('window-controls:closed', this.handleWindowControlsClosed)
    this.ipcMain.on('window-controls:hide', this.handleWindowControlsHide)
    this.ipcMain.on('window-controls:minimize', this.handleWindowControlsMinimize)
    this.ipcMain.on('window-controls:maximize', this.handleWindowControlsMaximize)
    this.ipcMain.on('window:reload', this.handleWindowReload)
    this.ipcMain.on('window:rebuild-menu', this.handleWindowRebuildMenu)

    // ===================== HARDWARE =====================
    this.registerHandle('hardware:get-available-communication-ports', this.handleHardwareGetAvailableCommunicationPorts)
    this.registerHandle('hardware:get-available-boards', this.handleHardwareGetAvailableBoards)
    this.registerHandle('hardware:refresh-communication-ports', this.handleHardwareRefreshCommunicationPorts)
    this.registerHandle('hardware:refresh-available-boards', this.handleHardwareRefreshAvailableBoards)

    // ===================== PACKAGE MANAGER =====================
    this.registerHandle('packages:import-from-file', this.handlePackagesImportFromFile)
    this.registerHandle('packages:install-from-url', this.handlePackagesInstallFromUrl)
    this.registerHandle('packages:list-installed', this.handlePackagesListInstalled)
    this.registerHandle('packages:uninstall', this.handlePackagesUninstall)
    this.registerHandle('packages:get-manifest', this.handlePackagesGetManifest)
    this.registerHandle('packages:verify-signatures', this.handlePackagesVerifySignatures)

    // ===================== UTILITIES =====================
    this.registerHandle('util:get-preview-image', this.handleUtilGetPreviewImage)
    this.ipcMain.on('util:log', this.handleUtilLog)
    this.registerHandle('util:read-debug-file', this.handleReadDebugFile)

    // ===================== DEBUGGER =====================
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
    // VPP licensing over the HELD link — callable any time the device is
    // connected, deliberately not folded into `device:connect`. See the handlers.
    this.registerHandle('device:read-license', this.handleDeviceReadLicense)
    this.registerHandle('device:refresh-license', this.handleDeviceRefreshLicense)
    this.registerHandle('session:open-runtime', this.handleOpenRuntimeSession)
    this.registerHandle('session:close-runtime', this.handleCloseRuntimeSession)

    // ===================== RUNTIME API =====================
    this.registerHandle('runtime:get-users-info', this.handleRuntimeGetUsersInfo)
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
    this.registerHandle('runtime:discover-devices', this.handleRuntimeDiscoverDevices)

    // ===================== ETHERCAT DISCOVERY =====================
    this.registerHandle('ethercat:get-interfaces', this.handleEtherCATGetInterfaces)
    this.registerHandle('ethercat:get-status', this.handleEtherCATGetStatus)
    this.registerHandle('ethercat:scan', this.handleEtherCATScan)
    this.registerHandle('ethercat:test', this.handleEtherCATTest)
    this.registerHandle('ethercat:validate', this.handleEtherCATValidate)
    this.registerHandle('ethercat:get-runtime-status', this.handleEtherCATGetRuntimeStatus)

    // ===================== ESI REPOSITORY =====================
    this.registerHandle('esi:load-repository-index', this.handleESILoadRepositoryIndex)
    this.registerHandle('esi:save-xml-file', this.handleESISaveXmlFile)
    this.registerHandle('esi:load-xml-file', this.handleESILoadXmlFile)
    this.registerHandle('esi:delete-xml-file', this.handleESIDeleteXmlFile)
    this.registerHandle('esi:parse-and-save-file', this.handleESIParseAndSaveFile)
    this.registerHandle('esi:clear-repository', this.handleESIClearRepository)
    this.registerHandle('esi:load-device-full', this.handleESILoadDeviceFull)
    this.registerHandle('esi:load-repository-light', this.handleESILoadRepositoryLight)
    this.registerHandle('esi:migrate-repository', this.handleESIMigrateRepository)

    // ===================== SIMULATOR =====================
    this.registerHandle('simulator:load-firmware', this.handleSimulatorLoadFirmware)
    this.registerHandle('simulator:stop', this.handleSimulatorStop)
    this.registerHandle('simulator:is-running', this.handleSimulatorIsRunning)

    // ===================== FILE WATCHER =====================
    this.registerHandle('file:watch-start', this.handleFileWatchStart)
    this.registerHandle('file:watch-stop', this.handleFileWatchStop)
    this.registerHandle('file:watch-stop-all', this.handleFileWatchStopAll)
    this.registerHandle('file:read-content', this.handleFileReadContent)
  }

  // ===================== HANDLER METHODS =====================
  // Project-related handlers
  handleProjectCreate = async (_event: IpcMainInvokeEvent, data: CreateProjectFileProps) => {
    this.stopSimulatorAndNotify()
    const response = await this.projectService.createProject(data)
    // Mirror `handleProjectOpen`: a freshly-created project is the
    // active project from this point on, so any sandboxed file IPC
    // that gates on `validateFilePath` (file:read-content, watcher
    // start/stop) has a project root to compare against.  Skipping
    // this left newly-created library projects unable to read their
    // own `library.json` on first mount of the manifest tab.
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
      // Update lastMtime for the saved file's watcher to suppress self-trigger
      const watcherData = this.fileWatchers.get(filePath)
      if (watcherData) {
        try {
          const stats = statSync(filePath)
          if (stats.mtimeMs > watcherData.lastMtime) {
            watcherData.lastMtime = stats.mtimeMs
          }
        } catch {
          /* file may not exist */
        }
      }
    }
    return result
  }
  handleWriteProjectFiles = (_event: IpcMainInvokeEvent, files: unknown) =>
    this.projectService.writeProjectFiles(files as Parameters<typeof this.projectService.writeProjectFiles>[0])
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

  handleReadProjectFiles = async (_event: IpcMainInvokeEvent, projectPath: string) => {
    try {
      this.stopSimulatorAndNotify()
      const result = await this.projectService.readRawProjectFiles(projectPath)
      if (result.success) {
        this.currentProjectPath = projectPath
        await this.projectService.updateProjectHistory(projectPath)
      }
      return result
    } catch (_error) {
      return {
        success: false,
        error: { title: 'Error reading project', description: 'Failed to read project files' },
      }
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

  // Pou-related handlers
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

  // App and system handlers
  handleOpenExternalLink = async (_event: IpcMainInvokeEvent, url: string) => {
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

  /**
   * Load every bundled .stlib archive shipped with the app.
   *
   * The archives live alongside the strucpp compiler binaries under
   * `<resources>/strucpp/libs/` — same dev-vs-packaged resolution
   * Electron uses for any other resource (`process.resourcesPath`
   * after packaging, the project root in dev). The .stlib files are
   * synced into that directory by the strucpp build pipeline so they
   * always travel with the strucpp version the compiler targets.
   *
   * Returns the parsed JSON contents in alphabetical filename order so
   * the renderer-side library tree renders deterministically across
   * platforms. Errors (missing dir, malformed JSON) propagate back to
   * the renderer so a startup failure surfaces as a UI error rather
   * than silently dropping libraries.
   */
  // Library manager handlers — system-wide IEC 61131-3 library pool
  // (bundled strucpp libs + user-installed .stlib / CODESYS imports).
  // Library identity is the strucpp manifest `name` shared with the
  // project's `libraries[]` field.
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
   * Catalog browse — proxies to the shared `listPublicLibraries`
   * client.  Renderer can't hit autonomy-edge directly (CSP /
   * cross-origin); the main process is the canonical egress.
   *
   * Errors are returned in a `{ success: false, error }` envelope
   * rather than thrown across the IPC boundary so the modal can
   * surface the failure without trying to read a rejected promise.
   */
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
    const batch = await this.libraryManagerModule.installFromCatalog(libraries)
    // Fire one change event for the whole batch — saves N renderer
    // refreshes for an N-library install.
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

  /**
   * Drop a project entry from `projects.json` (recent list).
   * Disk is untouched — the project's files stay where they are. The
   * renderer-side use case is the start-screen 3-dot menu's "Remove
   * from list" action: a no-confirmation no-op as far as data goes,
   * just hides the entry from the recents view.
   */
  handleRemoveProjectFromRecent = async (_event: unknown, projectPath: string) => {
    try {
      await this.projectService.removeProjectFromHistory(projectPath)
      return { success: true }
    } catch (error) {
      logger.error('Error removing project from history: ' + getErrorMessage(error))
      return { success: false, error: getErrorMessage(error) }
    }
  }

  /**
   * Recursively delete a project directory and drop it from the recent
   * list. The destructive half (`fs.rm`) is gated by the project-
   * service's `project.json` check — see `deleteProject` there for
   * the safety rationale. Returns the service's response shape
   * verbatim so the renderer can surface the failure message.
   */
  handleDeleteProject = async (_event: unknown, projectPath: string) => {
    try {
      return await this.projectService.deleteProject(projectPath)
    } catch (error) {
      logger.error('Error deleting project: ' + getErrorMessage(error))
      return { success: false, error: getErrorMessage(error) }
    }
  }
  handleAppQuit = () => {
    this.stopSimulator()
    if (this.mainWindow) {
      this.mainWindow.destroy()
    }
    app.quit()
  }

  // Compiler service handlers
  // TODO: This handle should be refactored to use a new approach on module implementation.
  handleCompilerExportProjectXml = (
    _ev: IpcMainInvokeEvent,
    pathToUserProject: string,
    dataToCreateXml: PLCProjectData,
    xmlFormatTarget: 'old-editor' | 'codesys',
  ) => this.compilerModule.createXmlFile(pathToUserProject, dataToCreateXml, xmlFormatTarget)

  handleRunCompileProgram = (event: IpcMainEvent, args: Array<string | PLCProjectData>) => {
    const mainProcessPort = event.ports[0]
    void this.compilerModule.compileProgram(args, mainProcessPort, this).catch((error) => {
      mainProcessPort.postMessage({
        logLevel: 'error',
        message: `${getErrorMessage(error)}\nStopping compilation process.`,
      })
      mainProcessPort.postMessage({ closePort: true })
      mainProcessPort.close()
    })
  }

  handleRunDebugCompilation = (event: IpcMainEvent, args: Array<string | PLCProjectData>) => {
    const mainProcessPort = event.ports[0]
    void this.compilerModule.compileForDebugger(args, mainProcessPort, this)
  }

  handleRunCompileLibrary = (event: IpcMainEvent, args: Array<string | PLCProjectData | boolean>) => {
    const mainProcessPort = event.ports[0]
    void this.compilerModule.compileLibrary(args, mainProcessPort, this)
  }

  /**
   * Bridge method consumed by the compiler module and the Library
   * Project build pipeline.  Resolves project-enabled library names
   * to parsed `.stlib` archives — bundled libs are always included,
   * the user-installed subset is filtered by name, and missing-
   * but-enabled names come back for the caller to surface as a
   * pre-compile "open the Library Manager" error.  Same call feeds
   * both the program build (strucpp.compile's `libraries:` option)
   * and the library build (compileStlib's dependency list) so the
   * verify pass can't drift from the actual compile.
   */
  loadEnabledArchives = (enabledNames: string[]): { archives: unknown[]; missing: string[] } =>
    this.libraryManagerModule.loadEnabledArchives(enabledNames)

  // TODO: These handlers are outdated and should be removed.
  // handleCompilerSetupEnvironment = (event: IpcMainEvent) => {
  //   const replyPort = Array.isArray(event.ports) && event.ports.length > 0 ? event.ports[0] : undefined
  //   if (replyPort) {
  //     void this.compilerService.setupEnvironment(replyPort)
  //   }
  // }
  // handleCompilerCreateBuildDirectory = (_ev: IpcMainInvokeEvent, pathToUserProject: string) =>
  //   this.compilerService.createBuildDirectoryIfNotExist(pathToUserProject)
  // handleCompilerBuildXmlFile = (
  //   _ev: IpcMainInvokeEvent,
  //   pathToUserProject: string,
  //   dataToCreateXml: PLCProjectData,
  // ) => this.compilerService.buildXmlFile(pathToUserProject, dataToCreateXml)
  // handleCompilerBuildStProgram = (event: IpcMainEvent, pathToXMLFile: string) => {
  //   const replyPort = Array.isArray(event.ports) && event.ports.length > 0 ? event.ports[0] : undefined
  //   if (replyPort) {
  //     this.compilerService.compileSTProgram(pathToXMLFile, replyPort)
  //   }
  // }
  // handleCompilerGenerateCFiles = (event: IpcMainEvent, pathToStProgram: string) => {
  //   const replyPort = Array.isArray(event.ports) && event.ports.length > 0 ? event.ports[0] : undefined
  //   if (replyPort) {
  //     this.compilerService.generateCFiles(pathToStProgram, replyPort)
  //   }
  // }

  // Window controls handlers
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
    // The reload wipes the renderer's store back to 'disconnected', so the
    // session has to go with the emulator — otherwise main keeps holding an open
    // simulator session that the reloaded UI has no idea about.
    this.stopSimulator()
    this.mainWindow?.webContents.reload()
  }
  handleWindowRebuildMenu = () => {
    void this.menuBuilder.buildMenu().catch((error) => {
      logger.error('Error rebuilding application menu:', error)
    })
  }

  // Hardware handlers
  handleHardwareGetAvailableCommunicationPorts = async () => this.hardwareModule.getAvailableSerialPorts()
  handleHardwareGetAvailableBoards = async () => this.hardwareModule.getAvailableBoards()
  handleHardwareRefreshCommunicationPorts = async () => this.hardwareModule.getAvailableSerialPorts()
  handleHardwareRefreshAvailableBoards = async () => this.hardwareModule.getAvailableBoards()

  // Package manager handlers
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
    const importResult = await this.packageManagerModule.importFromFile(result.filePaths[0])
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
    // Download in the main process — the renderer can't reach the install
    // pipeline directly, and main has clean fs / temp-dir ergonomics. The
    // VPP catalog backend serves a private S3 bucket through its own API,
    // so `downloadUrl` always points at the backend (never S3 directly).
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
      const importResult = await this.packageManagerModule.importFromFile(tempPath)
      if (importResult.success) {
        this.mainWindow?.webContents.send('packages:boards-updated')
      }
      return importResult
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    } finally {
      if (tempPath) {
        // Best-effort cleanup — never fail the install because the temp
        // file lingered; OS will reap it on reboot anyway.
        await unlink(tempPath).catch(() => {})
      }
    }
  }
  handlePackagesListInstalled = async () => this.packageManagerModule.listInstalled()
  handlePackagesUninstall = async (_event: IpcMainInvokeEvent, packageId: string) => {
    const result = this.packageManagerModule.uninstall(packageId)
    if (result.success) {
      this.mainWindow?.webContents.send('packages:boards-updated')
    }
    return result
  }
  // Re-verify installed VPP signatures (invoked by the renderer when a project
  // opens) and return the ids removed. If anything was dropped, notify the
  // renderer so the board/device list refreshes via the existing subscription.
  handlePackagesVerifySignatures = async (): Promise<string[]> => {
    const removed = this.packageManagerModule.verifyInstalledSignatures()
    if (removed.length > 0) {
      this.mainWindow?.webContents.send('packages:boards-updated')
    }
    return removed
  }
  handlePackagesGetManifest = async (_event: IpcMainInvokeEvent, packageId: string) =>
    this.packageManagerModule.getInstalledPackageManifest(packageId)

  // Utility handlers
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

      // STruC++ writes debug-map.json alongside generated_debug.cpp.
      // Consumed by the renderer via parseDebugMap.
      const debugMapPath = path.resolve(projectPath, 'build', boardTarget, 'src', 'debug-map.json')
      const content = await fs.readFile(debugMapPath, 'utf-8')
      return { success: true, content }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to read debug-map.json',
      }
    }
  }

  /**
   * Confirm the target is running the program that was just built.
   *
   * Modbus targets (serial, TCP, simulator) read this over the ONE held device
   * link, so the check runs on the same connection every later command uses — no
   * second client, and nothing to reconnect afterwards. Runtime v4 reads it over
   * its own WebSocket, which is a different protocol to a different target.
   */
  handleDebuggerVerifyMd5 = async (_event: IpcMainInvokeEvent, expectedMd5: string): Promise<Md5VerifyReply> => {
    try {
      return await this.withDebugChannel<Md5VerifyReply>(
        'verify md5',
        async (client) => {
          const probe = await client.getMd5Hash()
          // `targetMd5` spelled out rather than spread: `Md5ProbeResult` names the
          // hash `md5`, so `...probe` silently left the declared `targetMd5`
          // undefined — and TypeScript does not apply excess-property checks to a
          // spread, so nothing caught it. The mismatch report then read
          // "MD5 mismatch. Target: undefined", losing the one value that tells the
          // user which program is actually on the board.
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
   * FC 0x4b run/stop for a baremetal target.
   *
   * Command only — the state is READ from the status poll (FC 0x46), which already
   * reports it, so there is no second round trip here.
   *
   * Goes over the ONE held device link, whatever transport that link runs over.
   * The transport the DEBUGGER is using is not consulted, and no client is opened:
   * this is a command to the device, and the connection to it already exists.
   *
   * That is precisely what was broken. The old code only recognised an RTU client
   * as reusable, so with a live Modbus TCP session a Stop fell through to opening a
   * transient second socket — which an Arduino Modbus TCP server, serving one
   * client at a time, never answered. The user saw "Failed to stop PLC: Request
   * timeout" while a working connection sat idle.
   */
  handleDebuggerPlcControl = async (_event: IpcMainInvokeEvent, action: 'run' | 'stop'): Promise<PlcControlResult> => {
    this.traceDeviceLink(`run/stop: ${action} requested`)

    // Routed by the session's CONTROL channel, which is the whole point: the caller
    // said "stop the PLC" and does not know or care whether that means a Modbus
    // function code on a cable or an HTTP POST to a runtime.
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

  /**
   * Run/stop over a REST control channel, reported in the same shape the Modbus
   * path returns — so the caller handles one result type, not two.
   *
   * `ERROR_SWITCH_STOP` in the runtime's reply is its way of saying the hardware
   * mode switch refused a start, which is exactly what `refusedBySwitch` means on
   * the Modbus side (FC 0x4b status 0x86).
   */
  private async restSetPlcState(address: string, action: 'run' | 'stop'): Promise<PlcControlResult> {
    const result =
      action === 'run' ? await this.restStartPlc(address) : await this.makeRuntimeApiRequest(address, '/api/stop-plc')
    if (!result.success) return { success: false, error: result.error }

    const status = 'status' in result ? (result.status ?? '') : ''
    if (status.includes('ERROR_SWITCH_STOP')) return { success: false, refusedBySwitch: true }

    // The runtime settles into the new state on its next scan; report the state the
    // command asked for so the button can reflect it without a second round trip.
    return { success: true, state: action === 'run' ? PlcRuntimeState.RUNNING : PlcRuntimeState.STOPPED }
  }

  /** The `/api/start-plc` call, shared by the session router and the IPC handler. */
  private async restStartPlc(address: string): Promise<{ success: boolean; status?: string; error?: string }> {
    try {
      // The body is parsed because the runtime answers `COMMAND:BUSY` while it is
      // still unloading a previous program after an upload, and callers drive a
      // retry loop on that. See `backend/shared/library/start-plc-after-build.ts`.
      const result = await this.makeRuntimeApiRequest<{ status?: string }>(
        address,
        '/api/start-plc',
        (data: string) => JSON.parse(data) as { status?: string },
      )
      if (!result.success) return { success: false, error: result.error }
      return { success: true, status: (result.data?.status ?? '').trim() }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  }

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
    // A null connection type means the debugger was intentionally disconnected.
    // Fail silently so the renderer's poll loop ignores it.
    if (this.debuggerConnectionType === null) {
      return { success: false, error: 'Debugger not connected' }
    }

    // Every target reads over its session's DEBUG channel — Modbus for a device or
    // a v3 runtime, the WebSocket for v4. There is nothing to reconnect here: if a
    // connection dropped, the manager is already reopening it (or has reported it
    // lost), and `needsReconnect` tells the renderer to stop the session rather
    // than race it for the medium.
    try {
      return await this.withDebugChannel(
        'read variables',
        async (client) => {
          const result = await client.getVariablesList(variableIndexes)
          if (result.success && result.data) {
            // The debug poll is the busiest thing on the link; telling the session
            // about it is what stops the liveness read from queueing behind this
            // traffic and timing out on a link that is plainly working.
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

      // STruC++ writes the MD5 into debug-map.json alongside the pointer
      // tables. It's the single source of truth the editor and the target
      // agree on (target exposes the same value via FC 0x45).
      const debugMapPath = path.resolve(projectPath, 'build', boardTarget, 'src', 'debug-map.json')
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

  /**
   * Read the run/stop state over an already-open client and push it to the
   * renderer. Throttled, because its two callers tick at very different rates:
   * the device liveness poll (2.5s) and the debugger's variable poll (fast).
   *
   * Both callers use the ONE held connection, so there is no handoff to survive:
   * a debug session shares the link rather than replacing it, and the Start/Stop
   * button keeps tracking the device while debugging.
   */
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

  /**
   * Start a debug session against a target.
   *
   * For a Modbus target there is nothing to open: the session runs over the ONE
   * held device link, which Connect established and which the status poll keeps
   * honest. That is what makes serial debugging work at all (the OS will not lock
   * a port twice), and it is equally right for Modbus TCP (an Arduino TCP server
   * serves one client). The simulator is the exception only because it is
   * in-process, so it can bring its own link up on demand.
   *
   * Runtime v4 keeps its own WebSocket: different protocol, different target.
   */
  handleDebuggerConnect = async (_event: IpcMainInvokeEvent): Promise<{ success: boolean; error?: string }> => {
    try {
      // For a shared session this opens nothing — it is the connection Connect
      // established, already proven. For a runtime target it opens that target's
      // own debug channel, which is why the debugger asks for it here rather than
      // at login: the channel exists only while a session needs it.
      const channel = await this.requireDebug('debug session')
      if ('error' in channel) return { success: false, error: channel.error }

      // Session identity comes from the SESSION, not from what the caller guessed:
      // a connected target names no transport at all.
      this.debuggerConnectionType = this.deviceSession.getLink()?.transport ?? 'tcp'
      return { success: true }
    } catch (error) {
      this.debuggerConnectionType = null
      return { success: false, error: getErrorMessage(error) }
    }
  }

  /**
   * Stop a debug session: let go of the debug channel, nothing more.
   *
   * The SESSION is deliberately untouched — it belongs to Connect (or to the
   * runtime login), not to the debugger. Closing it here would drop the user's
   * connection, and the status poll driving the Start/Stop button with it, just
   * because they stopped debugging. Releasing closes a channel of its own once
   * nothing holds it, and never closes a channel shared with control.
   */
  handleDebuggerDisconnect = (_event: IpcMainInvokeEvent): Promise<{ success: boolean }> => {
    this.deviceSession.releaseDebugChannel('debug session')
    this.debuggerConnectionType = null
    return Promise.resolve({ success: true })
  }

  // ===================================================================
  // The device link — "stay connected", over serial or Modbus TCP
  // ===================================================================

  /** Push a link state change to the renderer. */
  private emitDeviceLinkStatus(status: DeviceLinkStatus): void {
    // `connecting` is not traced. It is a transient the user can already see in the
    // button, and it repeats once per candidate — on a baud sweep that is five
    // identical lines around the one outcome worth reading. Every settled state
    // (connected / disconnected / error) still gets its line.
    if (status.status !== 'connecting') {
      this.traceDeviceLink(
        `status -> ${status.status}${status.descriptor ? ` (${status.transport ?? '?'} ${status.descriptor})` : ''}${
          status.reason ? ` [${status.reason}]` : ''
        }`,
      )
    }
    this.mainWindow?.webContents?.send('device:connection-status', status)
  }

  /**
   * Diagnostic trace for the device connection, to BOTH sinks on purpose: the
   * main-process log file keeps it after the fact, and the renderer console puts
   * it where a user can read and copy it while reproducing something. Connection
   * problems span two processes and a piece of hardware; without this the only
   * evidence is "it hangs".
   */
  private traceDeviceLink(message: string): void {
    logger.info(`[link] ${message}`)
    this.mainWindow?.webContents?.send('device:link-log', message)
  }

  /**
   * Turn a resolved channel config into something the link manager can try.
   * The only transport-specific step left in the flow; a config that names a
   * transport this build cannot speak is dropped rather than half-built.
   */
  private toDeviceLinkCandidates(
    configs: DebugConnectionConfig[],
    opts: { probeBaudRates?: boolean } = {},
  ): DeviceLinkCandidate[] {
    const declared: DeviceLinkCandidate[] = []
    // Baud guesses go AFTER everything the project declared: a configured Modbus
    // TCP address is a better next try than a rate nobody asked for.
    const speculative: DeviceLinkCandidate[] = []

    const build = (config: DebugConnectionConfig, baudRate: number | undefined, isGuess: boolean): void => {
      const kind = modbusTransportKind(config.connectionType)
      if (kind === null) return
      const params = {
        connectionType: config.connectionType,
        port: config.connectionParams.port,
        baudRate,
        slaveId: config.connectionParams.slaveId,
        host: config.connectionParams.ipAddress,
      }
      // Only the simulator needs an in-process serial port; building one for a real
      // transport would allocate a virtual port nobody reads.
      const options = kind === 'simulator' ? { virtualSerialPort: new VirtualSerialPort(this.simulatorModule) } : {}
      // Probe the params now so a malformed config fails resolution rather than
      // becoming a candidate that always throws on `create()`.
      if ('error' in buildDeviceModbusTransport(params, options)) return
      ;(isGuess ? speculative : declared).push({
        transport: kind,
        // The endpoint ONLY. It is matched against the OS port list and against
        // the port an upload asks to borrow, so the baud travels beside it rather
        // than inside it — decorating this string made every swept candidate match
        // no port and be skipped in 1ms.
        descriptor: describeDebugEndpoint(config),
        baudRate,
        speculative: isGuess,
        create: () => {
          const built = buildDeviceModbusTransport(params, options)
          if ('error' in built) throw new Error(built.error)
          return built.client
        },
      })
    }

    for (const config of configs) {
      // A wrong baud is the one misconfiguration that looks like healthy silence:
      // the port opens, so it is not "no response", and nothing decodes, so it
      // reads as "no firmware" — and the user gets told to reflash a board that is
      // running fine. Sweeping the rates OpenPLC is ever built with turns that dead
      // end into a connection. Serial only; a TCP address is either right or not.
      for (const attempt of planBaudAttempts(config.connectionParams.baudRate, { sweep: opts.probeBaudRates })) {
        build(config, attempt.baudRate, attempt.speculative)
      }
    }

    // The patient budget belongs to the last DECLARED endpoint, not to the last
    // candidate overall. Without this the baud sweep would silently take that
    // patience away from the configured endpoint and hand it to a guess — and a
    // board that was just flashed, still booting on the right rate, would be ruled
    // out in ~10s instead of the ~32s it sometimes needs.
    const lastDeclared = declared[declared.length - 1]
    if (lastDeclared) lastDeclared.patient = true

    return [...declared, ...speculative]
  }

  /** Consume the classification the last verified candidate produced. */
  private takeDeviceLinkProbe(): DeviceProbeOutcome | null {
    const probe = this.deviceLinkProbe
    this.deviceLinkProbe = null
    return probe
  }

  /**
   * Establish a session with a Runtime v3/v4: control over REST, debug over the
   * channel its board declares (v3: Modbus TCP on the runtime's address; v4: the
   * debug WebSocket). Called once the renderer has logged in.
   *
   * The debug channel is only DESCRIBED here, not opened — see `acquireDebugChannel`.
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

  /**
   * Turn a resolved channel config into an openable DEBUG channel. The one place
   * that knows a WebSocket is a debug channel too.
   */
  private toDebugCandidate(config: DebugConnectionConfig): DeviceDebugCandidate | null {
    if (config.connectionType === 'websocket') {
      const host = config.connectionParams.ipAddress
      const token = config.connectionParams.jwtToken
      if (!host || !token) return null
      return {
        transport: 'websocket',
        descriptor: `websocket ${host}`,
        create: () => new WebSocketDebugTransport({ host, port: 8443, token, rejectUnauthorized: false }),
      }
    }
    // One config in, one candidate out: this builds the DEBUG channel for a
    // session that already exists, so the rate is settled and guessing is wrong.
    const [candidate] = this.toDeviceLinkCandidates([config], { probeBaudRates: false })
    if (!candidate) return null
    return {
      transport: candidate.transport,
      descriptor: `${candidate.transport} ${candidate.descriptor}`,
      create: candidate.create,
    }
  }

  /**
   * Is this freshly opened candidate a device we can work with? Runs the
   * connect-time classification (`classifyDeviceLink`) and keeps its verdict for
   * the renderer.
   *
   * Only `connected-with-firmware` keeps a candidate. A port that opens but has
   * no firmware, or an IP that answers something else, therefore falls through to
   * the next candidate instead of becoming a link that cannot serve a single
   * command.
   */
  private async verifyDeviceCandidate(
    client: DeviceModbusTransport,
    candidate: DeviceLinkCandidate,
    context: { isLastCandidate: boolean },
  ): Promise<boolean> {
    // The simulator is in-process: there is no hardware to identify, so the
    // board-id read is not the right question to ask of it.
    //
    // Retried because the session is opened the instant the emulator starts, and
    // the sketch inside it still has to reach the point where it services Modbus.
    // Failing here would stop an emulator that was merely still booting.
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

    // Be patient only with the LAST candidate. The id read is retried because a
    // board that was just flashed may still be booting — worth ~32s when this is
    // the only way in, but not while alternatives are waiting: a Modbus TCP
    // address that no longer answers should not delay the cable that would have
    // worked. (Measured on a real board: 32.5s to rule out one endpoint.)
    //
    // A speculative candidate never gets that patience, whether or not it happens
    // to be last: it is a baud rate NOBODY configured, and there are several of
    // them. Spending the patient budget on the final guess would put ~32s at the
    // end of a sweep whose whole point is to finish quickly.
    const isPatient = !candidate.speculative && (candidate.patient === true || context.isLastCandidate)
    const boardIdProbe = candidate.speculative
      ? SPECULATIVE_BOARD_ID_PROBE
      : isPatient
        ? PATIENT_BOARD_ID_PROBE
        : QUICK_BOARD_ID_PROBE
    const result = await classifyDeviceLink(client, { boardIdProbe })
    this.deviceLinkProbe = result
    if (result.status !== 'connected-with-firmware') {
      // Traced only when the endpoint is REJECTED, and then with the budget it was
      // given: "no firmware after 2 id reads (baud guess)" is a different problem
      // from "no firmware after 6" on the port the project configured. Announcing
      // the budget up front, as this used to, put the line before the outcome it
      // explains and printed it on every success too.
      this.traceDeviceLink(
        `  ${candidate.descriptor}: "${result.status}" after up to ${boardIdProbe.attempts} id read(s)` +
          `${candidate.speculative ? ' (baud guess)' : isPatient ? ' (last configured endpoint, was patient)' : ''}` +
          `${result.error ? ` — ${result.error}` : ''}`,
      )
      return false
    }
    // The status frame doubles as the run/stop state source; push it straight
    // away so the Start/Stop button is right before the first poll lands.
    await this.pushPlcState(client, candidate.descriptor, 0)
    return true
  }

  /**
   * Per-tick liveness read, and the ONE place baremetal run/stop state is polled.
   *
   * Prefers the status read (FC 0x46) over the board id (0x48): both prove the
   * firmware is answering, but the status frame also carries the run/stop state
   * and the mode-switch position — so a switch flipped by hand at the panel shows
   * up within one interval, with no second timer and no extra traffic.
   */
  private async probeDeviceLink(client: DeviceModbusTransport): Promise<boolean> {
    const descriptor = this.deviceSession.getLink()?.descriptor ?? ''
    if (client.getStatus) {
      const status = await client.getStatus()
      if (!status.success) return false
      this.plcStatePushedAt = 0
      await this.pushPlcState(client, descriptor, 0)
      return true
    }
    return (await client.getBoardId()).success
  }

  /**
   * Release the link if it holds `port` — the handoff before an upload takes the
   * same serial port. A Modbus TCP link is left alone: flashing over USB does not
   * disturb it, so debugging and run/stop survive an upload.
   *
   * Returns whether anything was released, so the caller knows to reconnect.
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
   * The channel for this operation family, or a reason there isn't one. Every
   * device command funnels through here, so "not connected" and "reconnecting"
   * read the same everywhere instead of each handler inventing its own message —
   * or, worse, opening its own connection.
   *
   * `debug` operations take the debug channel, which for a shared session IS the
   * control channel and for a runtime target is one of its own.
   */
  private requireControl(what: string): { client: DeviceModbusTransport } | ChannelUnavailable {
    const client = this.deviceClient()
    if (!client) return this.explainMissingChannel(what)
    this.traceChannelUse(what, 'control')
    return { client }
  }

  /**
   * The DEBUG channel, opening it if this session's debug medium is one of its own.
   * Every debug caller passes a distinct `what`, which doubles as the holder name —
   * so two callers can hold it at once without either closing it on the other.
   *
   * A holder acquired here MUST be released, or the channel can never close. Only
   * the debug session itself is a long-lived holder (acquired by `debugger:connect`,
   * released by `debugger:disconnect`); every per-command caller goes through
   * `withDebugChannel`, which releases in a `finally`.
   */
  private async requireDebug(what: string): Promise<{ client: DeviceDebugChannel } | ChannelUnavailable> {
    const acquired = await this.deviceSession.acquireDebugChannel(what)
    if ('error' in acquired) {
      if (!this.deviceSession.isConnected()) return this.explainMissingChannel(what)
      this.traceDeviceLink(`${what}: debug channel unavailable — ${acquired.error}`)
      return { error: acquired.error, needsReconnect: true }
    }
    this.traceChannelUse(what, 'debug')
    return acquired
  }

  /**
   * Run one command over the DEBUG channel, holding it only for the duration.
   *
   * The holder set is a reference count, and a per-command caller is not a holder
   * of the channel's LIFETIME — it just needs the channel to exist while it runs.
   * Registering those callers permanently is what kept a Runtime v3/v4 debug channel
   * open after the debug session ended: `read variables` is acquired on every poll
   * tick, so once one had run, `releaseDebugChannel('debug session')` always found
   * the set non-empty and skipped the close. The user stopped debugging and the
   * editor held an authenticated debug channel to their PLC until they logged out.
   *
   * Releasing here is safe for a BAREMETAL target, where control and debug are the
   * same channel: `releaseDebugChannel` returns early on `debugCandidate === null`
   * before touching any client, so it can never disconnect the device out from
   * under run/stop or the status poll. Only a session whose debug medium is its
   * own — v3's second Modbus TCP connection, v4's WebSocket — is ever closed.
   */
  private async withDebugChannel<T>(
    what: string,
    run: (client: DeviceDebugChannel) => Promise<T>,
    onUnavailable: (reason: ChannelUnavailable) => T,
  ): Promise<T> {
    const acquired = await this.requireDebug(what)
    if ('error' in acquired) return onUnavailable(acquired)
    try {
      return await run(acquired.client)
    } finally {
      this.deviceSession.releaseDebugChannel(what)
    }
  }

  /**
   * Which channel served which command — logged ONCE per distinct combination.
   *
   * The question this answers ("did run/stop really ride the same connection as
   * the debugger?") is answered by the first occurrence. Logging every occurrence
   * answered it several times a second: the debug poll reads variables
   * continuously, so an unfiltered trace emitted ~8 identical lines per second
   * and buried every other message in the console, including the ones explaining
   * a disconnect.
   */
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
      return { error: 'the connection dropped and is being restored — try again in a moment', needsReconnect: true }
    }
    this.traceDeviceLink(`${what}: refused, nothing is connected`)
    return { error: MainProcessBridge.DEVICE_NOT_CONNECTED, needsReconnect: true }
  }

  /**
   * The emulator boots in milliseconds, but "milliseconds" is not "instantly", and
   * its session is opened the instant it starts.
   */
  private static readonly SIMULATOR_PROBE_ATTEMPTS = 10
  private static readonly SIMULATOR_PROBE_INTERVAL_MS = 200

  /**
   * Reported when a command arrives and no session exists.
   *
   * Short and neutral on purpose. The caller already says which action failed
   * ("Failed to stop PLC: …", "Could not connect to debug target: …"), so this only
   * has to supply the reason. It used to explain the reason as well — "the debugger
   * and run/stop share the device connection" — which was written for a baremetal
   * board and read as nonsense on a Runtime v4, whose debug channel is its own
   * WebSocket and shares nothing. Worse, it appeared on a target the user HAD
   * connected to, so the explanation was not merely irrelevant but wrong.
   */
  private static readonly DEVICE_NOT_CONNECTED = 'not connected to the target'

  /**
   * Open and HOLD the link to a baremetal device (D72).
   *
   * `candidates` is the ordered list the renderer resolved from the board's debug
   * spec — Modbus TCP first when the project enables it, then serial. The manager
   * tries them in order and keeps the first that both opens and answers, so a
   * stale DHCP address or an unplugged ethernet shield falls through to the cable
   * instead of stranding the user on a link that cannot serve a command.
   *
   * The classification that used to be this method's job now happens per candidate
   * (`verifyDeviceCandidate`), because it is also what decides whether a candidate
   * is worth keeping.
   */
  handleDeviceConnect = async (
    _event: IpcMainInvokeEvent,
    candidates: DebugConnectionConfig[],
  ): Promise<DeviceProbeOutcome> => {
    this.deviceLinkProbe = null
    // A new connection is a new story: let each command say which channel served
    // it again, since it may well be a different one this time.
    this.tracedChannelUses.clear()
    this.traceDeviceLink(
      `connect requested with ${candidates.length} candidate(s): ${
        candidates.map((config) => `${config.connectionType} ${describeDebugEndpoint(config)}`).join(', ') || '(none)'
      }`,
    )

    const linkCandidates = this.toDeviceLinkCandidates(candidates)
    if (linkCandidates.length === 0) {
      // Publish a settled state before returning: this path never reaches
      // `deviceSession.open()`, so nothing else will, and the renderer set
      // 'connecting' the moment the user clicked. Left unsaid, its Connect button
      // stays disabled for the rest of the project's life.
      this.emitDeviceLinkStatus({ status: 'disconnected' })
      return { status: 'error', error: 'No usable serial or Modbus TCP connection was configured for this device.' }
    }

    const result = await this.deviceSession.open(linkCandidates)
    // Read the verdict out of the field after the open: verification runs inside
    // it, one candidate at a time, and this is where its conclusion lands.
    const probe = this.takeDeviceLinkProbe()
    if (result.ok) return probe ?? { status: 'connected-with-firmware' }

    // Nothing worked. A candidate that got far enough to be classified gives the
    // better message ("no firmware" beats "could not connect"); otherwise report
    // what was tried.
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

  // ===================== VPP LICENSING OVER THE HELD LINK =====================
  //
  // WHY THESE ARE ON-DEMAND, AND NOT PART OF `device:connect`.
  //
  // Two reasons, both learned the hard way. First, `refreshLicense` reaches the
  // NETWORK: folding it into connect makes every connect to a licensed board wait
  // on an HTTP round trip that may be rate-limited or time out, and a connect that
  // hangs looks like a broken cable. Second, a purchase happens AFTER the user has
  // already been told they are in demo mode — with licensing bolted to connect, the
  // only way to pick up a licence they just bought is to disconnect and reconnect,
  // or reflash. Exposing the step means the buy dialog can simply call it again on
  // the link that is already open.
  //
  // Both ride the CONTROL channel (`requireControl`): the license FCs are ordinary
  // frames on the same held Modbus link as run/stop and the status poll, so they
  // queue behind the same mutex and need no connection of their own.

  /**
   * True while a COMPOUND licensing sequence is running over the held client.
   *
   * The transports already serialise individual FRAMES, and that is not enough
   * here. `refreshLicense` is read -> HTTP -> write -> read, and two of them
   * running at once would each see perfectly atomic frames while interleaving a
   * read and a write of the SAME license — one sequence reading back the other's
   * blob and drawing a conclusion about it. The frame mutex cannot see the
   * sequence, so the sequence needs its own guard.
   */
  private deviceLicenseSequenceInFlight = false

  /**
   * Read the anchor the licensing identity derives from, over the held link.
   *
   * Read FRESH on every licensing call rather than cached at connect. The anchor
   * IS the device identity, and a board swapped on the same serial path would
   * otherwise inherit the previous one's — deciding a license question for
   * hardware that is no longer there. One extra frame on an operation that already
   * spends several is not worth that risk.
   */
  private async readLicenseAnchor(client: DeviceModbusTransport): Promise<{ anchor: Uint8Array } | { error: string }> {
    const board = await client.getBoardId()
    if (!board.success) return { error: board.error ?? 'the device did not answer the board-id read' }
    this.deviceSession.noteTraffic()
    return { anchor: board.boardId ?? new Uint8Array(0) }
  }

  /**
   * `device:read-license` — what license is this board holding right now?
   *
   * Read + verify only; never contacts the backend, so it is cheap enough for a
   * screen open. It answers the question the badge asks, which `device:connect`
   * deliberately does not.
   */
  handleDeviceReadLicense = async (
    _event: IpcMainInvokeEvent,
    request: DeviceLicenseRequest,
  ): Promise<DeviceLicenseReport> => {
    const control = this.requireControl('read license')
    if ('error' in control) return { outcome: { state: 'check-failed', error: control.error } }

    try {
      const anchor = await this.readLicenseAnchor(control.client)
      if ('error' in anchor) return { outcome: { state: 'check-failed', error: anchor.error } }

      return await inspectDeviceLicense(control.client, { ...request, anchor: anchor.anchor })
    } catch (error) {
      return { outcome: { state: 'check-failed', error: getErrorMessage(error) } }
    }
  }

  /**
   * `device:refresh-license` — the full flow, including the backend recovery.
   *
   * Called after a connect to a licensable board, and again after a purchase so a
   * device gets its license without disconnecting or reflashing.
   */
  handleDeviceRefreshLicense = async (
    _event: IpcMainInvokeEvent,
    request: DeviceLicenseRequest,
  ): Promise<DeviceLicenseReport> => {
    const control = this.requireControl('refresh license')
    if ('error' in control) return { outcome: { state: 'check-failed', error: control.error } }

    if (this.deviceLicenseSequenceInFlight) {
      // Reported rather than queued: the caller is a button or a connect, and a
      // second answer arriving later for a question already being answered is
      // noise at best and a contradictory badge at worst.
      return { outcome: { state: 'check-failed', error: 'A license check is already running on this device.' } }
    }
    this.deviceLicenseSequenceInFlight = true

    try {
      const anchor = await this.readLicenseAnchor(control.client)
      if ('error' in anchor) return { outcome: { state: 'check-failed', error: anchor.error } }

      const report = await resolveDeviceLicense(control.client, { ...request, anchor: anchor.anchor })
      // The license FCs are device traffic like any other: without noting them the
      // liveness poll can fall due mid-sequence and declare a healthy link lost.
      this.deviceSession.noteTraffic()
      return report
    } catch (error) {
      return { outcome: { state: 'check-failed', error: getErrorMessage(error) } }
    } finally {
      this.deviceLicenseSequenceInFlight = false
    }
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
          // Forcing values is device traffic too: it queues on the same link and
          // proves the same thing a read does. Without this, holding a force while
          // the poll is due lets the liveness read wait behind it and time out.
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

  // ===================== FILE WATCHER HANDLERS =====================

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
      // realpathSync fails if the file doesn't exist yet — fall back to resolve only
      const resolved = resolve(filePath)
      const projectRoot = resolve(this.currentProjectPath)
      return resolved.startsWith(projectRoot + sep) || resolved === projectRoot
    }
  }

  // ===================== SIMULATOR HANDLERS =====================

  /** Stops the simulator and notifies the renderer so it can update UI state. */
  private stopSimulatorAndNotify(): void {
    if (this.simulatorModule.isRunning()) {
      this.stopSimulator()
      this.mainWindow?.webContents.send('simulator:stopped')
    }
  }

  // ===================== ETHERCAT DISCOVERY HANDLERS =====================

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

  // ===================== ESI REPOSITORY HANDLERS =====================

  handleESILoadRepositoryIndex = async (_event: IpcMainInvokeEvent, projectPath: string) =>
    this.wrapServiceCall(async () => {
      const index = await this.esiService.loadRepositoryIndex(projectPath)
      return { success: true as const, data: index }
    })

  handleESISaveXmlFile = async (_event: IpcMainInvokeEvent, projectPath: string, itemId: string, xmlContent: string) =>
    this.wrapServiceCall(() => this.esiService.saveXmlFile(projectPath, itemId, xmlContent))

  handleESILoadXmlFile = async (_event: IpcMainInvokeEvent, projectPath: string, itemId: string) =>
    this.wrapServiceCall(() => this.esiService.loadXmlFile(projectPath, itemId))

  handleESIDeleteXmlFile = async (_event: IpcMainInvokeEvent, projectPath: string, itemId: string) =>
    this.wrapServiceCall(() => this.esiService.deleteRepositoryItemV2(projectPath, itemId))

  handleESIParseAndSaveFile = async (
    _event: IpcMainInvokeEvent,
    projectPath: string,
    filename: string,
    content: string,
  ) => this.wrapServiceCall(() => this.esiService.parseAndSaveFile(projectPath, filename, content))

  handleESIClearRepository = async (_event: IpcMainInvokeEvent, projectPath: string) =>
    this.wrapServiceCall(() => this.esiService.clearRepository(projectPath))

  handleESILoadDeviceFull = async (
    _event: IpcMainInvokeEvent,
    projectPath: string,
    itemId: string,
    deviceIndex: number,
  ) =>
    this.wrapServiceCall(async () => {
      const xmlResult = await this.esiService.loadXmlFile(projectPath, itemId)
      if (!xmlResult.success || !xmlResult.content) {
        return { success: false as const, error: xmlResult.error || 'XML file not found' }
      }
      return parseESIDeviceFull(xmlResult.content, deviceIndex)
    })

  handleESILoadRepositoryLight = async (_event: IpcMainInvokeEvent, projectPath: string) =>
    this.wrapServiceCall(() => this.esiService.loadRepositoryLight(projectPath))

  handleESIMigrateRepository = async (_event: IpcMainInvokeEvent, projectPath: string) =>
    this.wrapServiceCall(() => this.esiService.migrateRepositoryToV2(projectPath))

  /**
   * Start the emulator, then open its session.
   *
   * The running emulator IS the simulator's connection — there is no port to pick
   * and no address to configure, so nothing about it is ever resolved from a spec
   * or asked of the user. Opening the session here (rather than when the debugger
   * asks) is what makes the simulator behave like every other target downstream:
   * commands go to a session the manager holds, and when the emulator stops the
   * session ends the same way a pulled cable ends a serial one.
   */
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
      // A start that threw part-way still leaves state behind: `loadAndRun`
      // marks the emulator running before it finishes wiring, so a throw after
      // that point leaked a running emulator with no session — and no button to
      // reach it, because the renderer never learned it had started. Web ends up
      // in the right place through its worker, which cleans up and reports
      // 'stopped' when `loadAndRun` throws; this is the editor's counterpart.
      this.stopSimulator()
      return { success: false, error: getErrorMessage(error) }
    }
  }

  /**
   * Stop the emulator entirely — the simulator's Stop button means "stop the
   * simulator", not "stop the program it is running".
   */
  handleSimulatorStop = (_event: IpcMainInvokeEvent): Promise<{ success: boolean }> => {
    this.stopSimulator()
    return Promise.resolve({ success: true })
  }

  /**
   * The one way the emulator stops: session first, then the emulator, so the
   * debug client is dropped before the thing it talks to disappears.
   *
   * Every stop path routes through here on purpose. The session is a consumer of
   * the emulator, so an emulator that goes away while its session stays open
   * leaves the renderer gated on a session whose target no longer exists — which
   * a window reload and a failed start both used to do.
   */
  private stopSimulator(): void {
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

  // Using watchFile (polling-based) instead of watch for better macOS compatibility
  // fs.watch can fail when editors use "safe write" (write to temp file, then rename)
  handleFileWatchStart = (
    _event: IpcMainInvokeEvent,
    filePath: string,
  ): Promise<{ success: boolean; error?: string }> => {
    if (!this.validateFilePath(filePath)) {
      return Promise.resolve({ success: false, error: 'Path is outside the project directory' })
    }

    return new Promise((res) => {
      if (this.fileWatchers.has(filePath)) {
        res({ success: true })
        return
      }

      stat(filePath, (statErr, stats) => {
        if (statErr) {
          res({ success: false, error: `Failed to stat file: ${statErr.message}` })
          return
        }

        const initialMtime = stats.mtimeMs

        try {
          watchFile(filePath, { interval: 1000 }, (curr, prev) => {
            const watcherData = this.fileWatchers.get(filePath)
            if (!watcherData) return

            if (curr.mtimeMs > prev.mtimeMs && curr.mtimeMs > watcherData.lastMtime) {
              watcherData.lastMtime = curr.mtimeMs
              this.mainWindow?.webContents.send('file:external-change', { filePath })
            }
          })

          this.fileWatchers.set(filePath, { lastMtime: initialMtime })
          res({ success: true })
        } catch (error) {
          res({ success: false, error: `Failed to watch file: ${getErrorMessage(error)}` })
        }
      })
    })
  }

  handleFileWatchStop = (_event: IpcMainInvokeEvent, filePath: string): { success: boolean; error?: string } => {
    if (!this.validateFilePath(filePath)) {
      return { success: false, error: 'Path is outside the project directory' }
    }
    if (this.fileWatchers.has(filePath)) {
      unwatchFile(filePath)
      this.fileWatchers.delete(filePath)
    }
    return { success: true }
  }

  handleFileWatchStopAll = (_event: IpcMainInvokeEvent): { success: boolean } => {
    for (const [filePath] of this.fileWatchers) {
      unwatchFile(filePath)
    }
    this.fileWatchers.clear()
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

  // ===================== EVENT HANDLERS =====================
  mainIpcEventHandlers = {
    handleUpdateTheme: (_event: unknown, theme?: 'light' | 'dark' | 'nineties') => {
      const newTheme = theme ?? (nativeTheme.shouldUseDarkColors ? 'light' : 'dark')
      // nativeTheme only models light/dark; the 90's skin is UI-only and rides
      // on a light base (mirrors MenuBuilder.updateAppTheme). The store keeps
      // the full preference — it is the desktop's durable source of truth,
      // analogous to the edge backend's user preference on the web app.
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
