import { ESIService } from '@root/backend/editor/ethercat'
import { getRuntimeHttpsOptions } from '@root/backend/editor/utils/runtime-https-config'
import { parseESIDeviceFull } from '@root/backend/shared/ethercat/esi-parser-main'
import { PLCProjectData } from '@root/backend/shared/types/PLC/open-plc'
import { getErrorMessage } from '@root/frontend/utils/get-error-message'
import { RuntimeLogEntry } from '@root/middleware/shared/ports'
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
import { CreatePouFileProps } from '@root/types/IPC/pou-service'
import { CreateProjectFileProps } from '@root/types/IPC/project-service'
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { app, nativeTheme, shell } from 'electron'
import { readFile, realpathSync, stat, statSync, unwatchFile, watchFile } from 'fs'
import type { IncomingHttpHeaders, IncomingMessage } from 'http'
import https from 'https'
import { join, resolve, sep } from 'path'
import { platform } from 'process'

import { MainIpcModule, MainIpcModuleConstructor } from '../../../backend/editor/contracts/types/modules/ipc/main'
import { ModbusTcpClient } from '../../../backend/editor/modbus/modbus-client'
import { ModbusRtuClient } from '../../../backend/editor/modbus/modbus-rtu-client'
import { logger } from '../../../backend/editor/services'
import { getOpenProjectPath, getProjectPath } from '../../../backend/editor/utils'
import { WebSocketDebugClient } from '../../../backend/editor/websocket/websocket-debug-client'
import { SimulatorModule } from '../../../backend/shared/simulator/simulator-module'
import { VirtualSerialPort } from '../../../backend/shared/simulator/virtual-serial-port'

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
  private debuggerModbusClient: ModbusTcpClient | ModbusRtuClient | null = null
  private debuggerWebSocketClient: WebSocketDebugClient | null = null
  private debuggerTargetIp: string | null = null
  private debuggerReconnecting: boolean = false
  private debuggerConnectionType: 'tcp' | 'rtu' | 'websocket' | 'simulator' | null = null
  private debuggerRtuPort: string | null = null
  private debuggerRtuBaudRate: number | null = null
  private debuggerRtuSlaveId: number | null = null
  private debuggerJwtToken: string | null = null
  private runtimeCredentials: { ipAddress: string; username: string; password: string } | null = null
  private tokenRefreshInFlight: Promise<{ success: boolean; accessToken?: string; error?: string }> | null = null
  // Current project root path used to validate file-watcher IPC calls
  private currentProjectPath: string | null = null
  // File watchers for auto-reload functionality (using watchFile for better macOS compatibility)
  private fileWatchers: Map<string, { lastMtime: number }> = new Map()
  // avr8js ATmega2560 emulator instance for the built-in simulator
  private simulatorModule = new SimulatorModule()
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
  }

  // ===================== RUNTIME API HANDLERS =====================
  private readonly RUNTIME_API_PORT = 8443
  private readonly RUNTIME_CONNECTION_TIMEOUT_MS = 5000 // 5 seconds (important-comment)

  /**
   * Low-level HTTP helper that handles data accumulation, timeout, and error handling.
   * Returns the raw status code, response body, and headers for the caller to interpret.
   */
  private httpRequest(options: {
    method: 'GET' | 'POST'
    url: string
    body?: string
    headers?: Record<string, string>
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
      req.setTimeout(this.RUNTIME_CONNECTION_TIMEOUT_MS, () => {
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
  ) => {
    try {
      const res = await this.httpRequest({
        method: 'POST',
        url: this.runtimeUrl(ipAddress, '/api/create-user'),
        body: JSON.stringify({ username, password, role: 'user' }),
      })
      if (res.statusCode === 201) {
        return { success: true }
      }
      return { success: false, error: res.data }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
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
      this.runtimeCredentials = { ipAddress, username, password }
    }
    return result
  }

  private async attemptTokenRefresh(): Promise<{ success: boolean; accessToken?: string; error?: string }> {
    if (this.tokenRefreshInFlight) {
      return this.tokenRefreshInFlight
    }

    if (!this.runtimeCredentials) {
      return { success: false, error: 'No stored credentials available for token refresh' }
    }

    const { ipAddress, username, password } = this.runtimeCredentials

    this.tokenRefreshInFlight = this.performAuthentication(ipAddress, username, password).finally(() => {
      this.tokenRefreshInFlight = null
    })

    return this.tokenRefreshInFlight
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
    jwtToken: string,
    endpoint: string,
    responseParser?: (data: string) => T,
  ): Promise<{ success: true; data?: T } | { success: false; error: string }> {
    try {
      const url = this.runtimeUrl(ipAddress, endpoint)
      const res = await this.httpRequest({
        method: 'GET',
        url,
        headers: { Authorization: `Bearer ${jwtToken}` },
      })

      if (res.statusCode === 200) {
        return this.parseApiResponse(res.data, responseParser)
      }

      if (!this.isTokenExpiredError(res.statusCode, res.data)) {
        return { success: false, error: res.data }
      }

      // Attempt token refresh and retry
      const refreshResult = await this.attemptTokenRefresh()
      if (!refreshResult.success || !refreshResult.accessToken) {
        return {
          success: false,
          error: refreshResult.error ? `Token refresh failed: ${refreshResult.error}` : res.data,
        }
      }

      this.mainWindow?.webContents?.send('runtime:token-refreshed', refreshResult.accessToken)

      const retryRes = await this.httpRequest({
        method: 'GET',
        url,
        headers: { Authorization: `Bearer ${refreshResult.accessToken}` },
      })

      if (retryRes.statusCode === 200) {
        return this.parseApiResponse(retryRes.data, responseParser)
      }
      return { success: false, error: retryRes.data }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
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
    jwtToken: string,
    endpoint: string,
    body: string,
    responseParser: (data: string) => T,
    timeoutMs?: number,
  ): Promise<{ success: true; data: T } | { success: false; error: string }> {
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

    return doRequest(jwtToken).then((result) => {
      const statusCode = !result.success ? result.statusCode : undefined
      if (!result.success && this.isTokenExpiredError(statusCode, result.error)) {
        return this.attemptTokenRefresh().then((refreshResult) => {
          if (refreshResult.success && refreshResult.accessToken) {
            if (this.mainWindow && this.mainWindow.webContents) {
              this.mainWindow.webContents.send('runtime:token-refreshed', refreshResult.accessToken)
            }
            return doRequest(refreshResult.accessToken).then(stripStatus)
          }
          return { success: false as const, error: `Token refresh failed: ${refreshResult.error || 'Unknown error'}` }
        })
      }
      return stripStatus(result)
    })
  }

  handleRuntimeGetStatus = async (
    _event: IpcMainInvokeEvent,
    ipAddress: string,
    jwtToken: string,
    includeStats?: boolean,
  ) => {
    try {
      // Build the endpoint path with optional include_stats query parameter
      const endpoint = includeStats ? '/api/status?include_stats=true' : '/api/status'

      const result = await this.makeRuntimeApiRequest<{
        status: string
        timing_stats?: {
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
      }>(ipAddress, jwtToken, endpoint, (data: string) => {
        const response = JSON.parse(data) as {
          status: string
          timing_stats?: {
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
        }
        return response
      })

      if (result.success && result.data) {
        return {
          success: true,
          status: result.data.status,
          timingStats: result.data.timing_stats,
        }
      } else {
        return { success: false, error: !result.success ? result.error : 'Unknown error' }
      }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  }

  handleRuntimeStartPlc = async (_event: IpcMainInvokeEvent, ipAddress: string, jwtToken: string) => {
    try {
      return await this.makeRuntimeApiRequest(ipAddress, jwtToken, '/api/start-plc')
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  }

  handleRuntimeStopPlc = async (_event: IpcMainInvokeEvent, ipAddress: string, jwtToken: string) => {
    try {
      return await this.makeRuntimeApiRequest(ipAddress, jwtToken, '/api/stop-plc')
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  }

  handleRuntimeGetCompilationStatus = async (_event: IpcMainInvokeEvent, ipAddress: string, jwtToken: string) => {
    try {
      const result = await this.makeRuntimeApiRequest<{ status: string; logs: string[]; exit_code: number | null }>(
        ipAddress,
        jwtToken,
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

  handleRuntimeGetLogs = async (_event: IpcMainInvokeEvent, ipAddress: string, jwtToken: string, minId?: number) => {
    try {
      const endpoint = minId !== undefined ? `/api/runtime-logs?id=${minId}` : '/api/runtime-logs'
      const result = await this.makeRuntimeApiRequest<string | RuntimeLogEntry[]>(
        ipAddress,
        jwtToken,
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
    this.runtimeCredentials = null
    return { success: true }
  }

  handleRuntimeGetSerialPorts = async (
    _event: IpcMainInvokeEvent,
    ipAddress: string,
    jwtToken: string,
  ): Promise<{ success: boolean; ports?: Array<{ device: string; description?: string }>; error?: string }> => {
    try {
      const result = await this.makeRuntimeApiRequest<{ ports: Array<{ device: string; description?: string }> }>(
        ipAddress,
        jwtToken,
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

    // Pou-related handlers
    this.registerHandle('pou:create', this.handleCreatePouFile)
    this.registerHandle('pou:delete', this.handleDeletePouFile)
    this.registerHandle('pou:rename', this.handleRenamePouFile)

    // App and system handlers
    this.registerHandle('open-external-link', this.handleOpenExternalLink)
    this.registerHandle('system:get-system-info', this.handleGetSystemInfo)
    this.registerHandle('app:store-retrieve-recent', this.handleStoreRetrieveRecent)
    this.ipcMain.on('app:quit', this.handleAppQuit)
    // this.ipcMain.on('app:reply-if-app-is-closing', (_, shouldQuit) => { ... })

    // Theme and store handlers
    this.ipcMain.on('system:update-theme', this.mainIpcEventHandlers.handleUpdateTheme)
    // this.ipcMain.handle('app:store-get', this.mainIpcEventHandlers.getStoreValue)

    // ===================== COMPILER SERVICE =====================
    // TODO: This handle should be refactored to use MessagePortMain for better performance.
    this.registerHandle('compiler:export-project-xml', this.handleCompilerExportProjectXml)
    this.ipcMain.on('compiler:run-compile-program', this.handleRunCompileProgram)
    this.ipcMain.on('compiler:run-debug-compilation', this.handleRunDebugCompilation)

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

    // ===================== UTILITIES =====================
    this.registerHandle('util:get-preview-image', this.handleUtilGetPreviewImage)
    this.ipcMain.on('util:log', this.handleUtilLog)
    this.registerHandle('util:read-debug-file', this.handleReadDebugFile)

    // ===================== DEBUGGER =====================
    this.registerHandle('debugger:verify-md5', this.handleDebuggerVerifyMd5)
    this.registerHandle('debugger:read-program-st-md5', this.handleReadProgramStMd5)
    this.registerHandle('debugger:get-variables-list', this.handleDebuggerGetVariablesList)
    this.registerHandle('debugger:set-variable', this.handleDebuggerSetVariable)
    this.registerHandle('debugger:connect', this.handleDebuggerConnect)
    this.registerHandle('debugger:disconnect', this.handleDebuggerDisconnect)

    // ===================== RUNTIME API =====================
    this.registerHandle('runtime:get-users-info', this.handleRuntimeGetUsersInfo)
    this.registerHandle('runtime:create-user', this.handleRuntimeCreateUser)
    this.registerHandle('runtime:login', this.handleRuntimeLogin)
    this.registerHandle('runtime:get-status', this.handleRuntimeGetStatus)
    this.registerHandle('runtime:start-plc', this.handleRuntimeStartPlc)
    this.registerHandle('runtime:stop-plc', this.handleRuntimeStopPlc)
    this.registerHandle('runtime:get-compilation-status', this.handleRuntimeGetCompilationStatus)
    this.registerHandle('runtime:get-logs', this.handleRuntimeGetLogs)
    this.registerHandle('runtime:clear-credentials', this.handleRuntimeClearCredentials)
    this.registerHandle('runtime:get-serial-ports', this.handleRuntimeGetSerialPorts)

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

    return {
      OS: platform,
      architecture: 'x64',
      prefersDarkMode: nativeTheme.shouldUseDarkColors,
      isWindowMaximized: this.mainWindow?.isMaximized(),
    }
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
  handleAppQuit = () => {
    this.simulatorModule.stop()
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
    void this.compilerModule.compileProgram(args, mainProcessPort, this)
  }

  handleRunDebugCompilation = (event: IpcMainEvent, args: Array<string | PLCProjectData>) => {
    const mainProcessPort = event.ports[0]
    void this.compilerModule.compileForDebugger(args, mainProcessPort)
  }

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
    this.simulatorModule.stop()
    this.mainWindow?.webContents.reload()
  }
  handleWindowRebuildMenu = () => void this.menuBuilder.buildMenu()

  // Hardware handlers
  handleHardwareGetAvailableCommunicationPorts = async () => this.hardwareModule.getAvailableSerialPorts()
  handleHardwareGetAvailableBoards = async () => this.hardwareModule.getAvailableBoards()
  handleHardwareRefreshCommunicationPorts = async () => this.hardwareModule.getAvailableSerialPorts()
  handleHardwareRefreshAvailableBoards = async () => this.hardwareModule.getAvailableBoards()

  // Utility handlers
  handleUtilGetPreviewImage = async (_event: IpcMainInvokeEvent, image: string) =>
    this.hardwareModule.getBoardImagePreview(image)
  handleUtilLog = (_: IpcMainEvent, { level, message }: { level: 'info' | 'error'; message: string }) => {
    logger[level](message)
  }
  handleReadDebugFile = async (_event: IpcMainInvokeEvent, projectPath: string, boardTarget: string) => {
    try {
      const fs = await import('fs/promises')
      const path = await import('path')

      // projectPath is already the project directory, not a file path
      // Guard against traversal/absolute input in boardTarget
      if (path.isAbsolute(boardTarget) || boardTarget.includes('..') || boardTarget.includes(path.sep)) {
        return { success: false, error: 'Invalid board target' }
      }
      const debugFilePath = path.resolve(projectPath, 'build', boardTarget, 'src', 'debug.c')

      const content = await fs.readFile(debugFilePath, 'utf-8')
      return { success: true, content }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to read debug.c file',
      }
    }
  }

  handleDebuggerVerifyMd5 = async (
    _event: IpcMainInvokeEvent,
    connectionType: 'tcp' | 'rtu' | 'websocket' | 'simulator',
    connectionParams: {
      ipAddress?: string
      port?: string
      baudRate?: number
      slaveId?: number
      jwtToken?: string
    },
    expectedMd5: string,
  ): Promise<{ success: boolean; match?: boolean; targetMd5?: string; error?: string }> => {
    let client: ModbusTcpClient | ModbusRtuClient | null = null
    let wsClient: WebSocketDebugClient | null = null
    try {
      if (connectionType === 'simulator') {
        const virtualPort = new VirtualSerialPort(this.simulatorModule)
        client = new ModbusRtuClient({
          port: 'simulator',
          baudRate: 115200,
          slaveId: 1,
          timeout: 5000,
          serialPort: virtualPort,
        })
        await client.connect()
        const targetMd5 = await client.getMd5Hash()
        const match = targetMd5.toLowerCase() === expectedMd5.toLowerCase()

        // Keep the client for subsequent debug operations
        this.debuggerModbusClient = client
        this.debuggerConnectionType = 'simulator'

        return { success: true, match, targetMd5 }
      } else if (connectionType === 'websocket') {
        if (!connectionParams.ipAddress || !connectionParams.jwtToken) {
          return { success: false, error: 'IP address and JWT token are required for WebSocket connection' }
        }
        if (!this.debuggerWebSocketClient) {
          wsClient = new WebSocketDebugClient({
            host: connectionParams.ipAddress,
            port: 8443,
            token: connectionParams.jwtToken,
            rejectUnauthorized: false,
          })
          await wsClient.connect()
        } else {
          wsClient = this.debuggerWebSocketClient
        }

        const targetMd5 = await wsClient.getMd5Hash()

        const match = targetMd5.toLowerCase() === expectedMd5.toLowerCase()

        if (!this.debuggerWebSocketClient) {
          this.debuggerWebSocketClient = wsClient
          this.debuggerTargetIp = connectionParams.ipAddress
          this.debuggerJwtToken = connectionParams.jwtToken
          this.debuggerConnectionType = 'websocket'
        }

        return { success: true, match, targetMd5 }
      } else if (connectionType === 'tcp') {
        if (!connectionParams.ipAddress) {
          return { success: false, error: 'IP address is required for TCP connection' }
        }
        client = new ModbusTcpClient({
          host: connectionParams.ipAddress,
          port: 502,
          timeout: 5000,
        })
      } else {
        if (!connectionParams.port || !connectionParams.baudRate || connectionParams.slaveId === undefined) {
          return { success: false, error: 'Port, baud rate, and slave ID are required for RTU connection' }
        }

        // Reuse existing RTU client if already connected to the same port
        if (
          this.debuggerModbusClient &&
          this.debuggerConnectionType === 'rtu' &&
          this.debuggerRtuPort === connectionParams.port
        ) {
          const targetMd5 = await this.debuggerModbusClient.getMd5Hash()
          const match = targetMd5.toLowerCase() === expectedMd5.toLowerCase()
          return { success: true, match, targetMd5 }
        }

        client = new ModbusRtuClient({
          port: connectionParams.port,
          baudRate: connectionParams.baudRate,
          slaveId: connectionParams.slaveId,
          timeout: 5000,
        })
      }

      await client.connect()
      const targetMd5 = await client.getMd5Hash()

      const match = targetMd5.toLowerCase() === expectedMd5.toLowerCase()

      if (connectionType === 'tcp') {
        client.disconnect()
      } else {
        this.debuggerModbusClient = client
        this.debuggerConnectionType = 'rtu'
        this.debuggerRtuPort = connectionParams.port!
        this.debuggerRtuBaudRate = connectionParams.baudRate!
        this.debuggerRtuSlaveId = connectionParams.slaveId!
      }

      return { success: true, match, targetMd5 }
    } catch (error) {
      client?.disconnect()
      wsClient?.disconnect()
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during MD5 verification',
      }
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

      // projectPath is already the project directory, not a file path
      // Guard against traversal/absolute input in boardTarget
      if (path.isAbsolute(boardTarget) || boardTarget.includes('..') || boardTarget.includes(path.sep)) {
        return { success: false, error: 'Invalid board target' }
      }
      const programStPath = path.resolve(projectPath, 'build', boardTarget, 'src', 'program.st')

      const content = await fs.readFile(programStPath, 'utf-8')

      const md5Pattern = /\(\*DBG:char md5\[\] = "([a-fA-F0-9]{32})";?\*\)/
      const match = content.match(md5Pattern)

      if (!match || !match[1]) {
        return {
          success: false,
          error: 'Could not find MD5 hash in program.st file',
        }
      }

      return { success: true, md5: match[1] }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to read program.st file',
      }
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
    // If connection type is null, the debugger was intentionally disconnected.
    // Return a silent failure so the renderer polling ignores it.
    if (this.debuggerConnectionType === null) {
      return { success: false, error: 'Debugger not connected' }
    }

    if (this.debuggerConnectionType === 'websocket') {
      if (!this.debuggerWebSocketClient) {
        if (this.debuggerReconnecting) {
          return { success: false, error: 'Reconnection in progress', needsReconnect: true }
        }

        this.debuggerReconnecting = true
        try {
          if (!this.debuggerTargetIp || !this.debuggerJwtToken) {
            this.debuggerReconnecting = false
            return { success: false, error: 'No target IP or JWT token stored', needsReconnect: true }
          }
          this.debuggerWebSocketClient = new WebSocketDebugClient({
            host: this.debuggerTargetIp,
            port: 8443,
            token: this.debuggerJwtToken,
            rejectUnauthorized: false,
          })
          await this.debuggerWebSocketClient.connect()
          this.debuggerReconnecting = false
        } catch (error) {
          this.debuggerWebSocketClient = null
          this.debuggerReconnecting = false
          return { success: false, error: `Failed to reconnect: ${getErrorMessage(error)}`, needsReconnect: true }
        }
      }

      try {
        const result = await this.debuggerWebSocketClient.getVariablesList(variableIndexes)

        if (result.success && result.data) {
          return {
            success: true,
            tick: result.tick,
            lastIndex: result.lastIndex,
            data: Array.from(result.data),
          }
        }

        return { success: false, error: result.error }
      } catch (error) {
        if (this.debuggerWebSocketClient) {
          this.debuggerWebSocketClient.disconnect()
          this.debuggerWebSocketClient = null
        }
        return { success: false, error: getErrorMessage(error), needsReconnect: true }
      }
    }

    if (!this.debuggerModbusClient) {
      if (this.debuggerReconnecting) {
        return { success: false, error: 'Reconnection in progress', needsReconnect: true }
      }

      this.debuggerReconnecting = true
      try {
        if (this.debuggerConnectionType === 'simulator') {
          const virtualPort = new VirtualSerialPort(this.simulatorModule)
          this.debuggerModbusClient = new ModbusRtuClient({
            port: 'simulator',
            baudRate: 115200,
            slaveId: 1,
            timeout: 5000,
            serialPort: virtualPort,
          })
        } else if (this.debuggerConnectionType === 'tcp') {
          if (!this.debuggerTargetIp) {
            this.debuggerReconnecting = false
            return { success: false, error: 'No target IP address stored', needsReconnect: true }
          }
          this.debuggerModbusClient = new ModbusTcpClient({
            host: this.debuggerTargetIp,
            port: 502,
            timeout: 5000,
          })
        } else if (this.debuggerConnectionType === 'rtu') {
          if (!this.debuggerRtuPort || !this.debuggerRtuBaudRate || this.debuggerRtuSlaveId === null) {
            this.debuggerReconnecting = false
            return { success: false, error: 'No RTU connection parameters stored', needsReconnect: true }
          }
          this.debuggerModbusClient = new ModbusRtuClient({
            port: this.debuggerRtuPort,
            baudRate: this.debuggerRtuBaudRate,
            slaveId: this.debuggerRtuSlaveId,
            timeout: 5000,
          })
        } else {
          this.debuggerReconnecting = false
          return { success: false, error: 'No connection type stored', needsReconnect: true }
        }

        await this.debuggerModbusClient.connect()
        this.debuggerReconnecting = false
      } catch (error) {
        this.debuggerModbusClient = null
        this.debuggerReconnecting = false
        return { success: false, error: `Failed to reconnect: ${getErrorMessage(error)}`, needsReconnect: true }
      }
    }

    try {
      const result = await this.debuggerModbusClient.getVariablesList(variableIndexes)

      if (result.success && result.data) {
        return {
          success: true,
          tick: result.tick,
          lastIndex: result.lastIndex,
          data: Array.from(result.data),
        }
      }

      return { success: false, error: result.error }
    } catch (error) {
      if (this.debuggerModbusClient) {
        this.debuggerModbusClient.disconnect()
        this.debuggerModbusClient = null
      }
      return { success: false, error: getErrorMessage(error), needsReconnect: true }
    }
  }

  handleDebuggerConnect = async (
    _event: IpcMainInvokeEvent,
    connectionType: 'tcp' | 'rtu' | 'websocket' | 'simulator',
    connectionParams: {
      ipAddress?: string
      port?: string
      baudRate?: number
      slaveId?: number
      jwtToken?: string
    },
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      if (connectionType === 'simulator') {
        if (this.debuggerModbusClient) {
          this.debuggerModbusClient.disconnect()
          this.debuggerModbusClient = null
        }

        const virtualPort = new VirtualSerialPort(this.simulatorModule)
        this.debuggerModbusClient = new ModbusRtuClient({
          port: 'simulator',
          baudRate: 115200,
          slaveId: 1,
          timeout: 5000,
          serialPort: virtualPort,
        })
        await this.debuggerModbusClient.connect()

        // Trigger endianness detection on the emulated runtime.
        // getMd5Hash sends 0xDEAD which the runtime uses to detect byte order
        // and call set_endianness(). Without this, the default SAME_ENDIANNESS
        // causes multi-byte values to be stored with swapped bytes on the
        // little-endian AVR emulator.
        await this.debuggerModbusClient.getMd5Hash()
      } else if (connectionType === 'websocket') {
        if (this.debuggerModbusClient) {
          this.debuggerModbusClient.disconnect()
          this.debuggerModbusClient = null
        }

        if (!connectionParams.ipAddress || !connectionParams.jwtToken) {
          return { success: false, error: 'IP address and JWT token are required for WebSocket connection' }
        }

        if (!this.debuggerWebSocketClient || this.debuggerConnectionType !== 'websocket') {
          if (this.debuggerWebSocketClient) {
            this.debuggerWebSocketClient.disconnect()
            this.debuggerWebSocketClient = null
          }

          this.debuggerWebSocketClient = new WebSocketDebugClient({
            host: connectionParams.ipAddress,
            port: 8443,
            token: connectionParams.jwtToken,
            rejectUnauthorized: false,
          })
          await this.debuggerWebSocketClient.connect()
        }

        this.debuggerTargetIp = connectionParams.ipAddress
        this.debuggerJwtToken = connectionParams.jwtToken
      } else if (connectionType === 'tcp') {
        if (this.debuggerModbusClient) {
          this.debuggerModbusClient.disconnect()
          this.debuggerModbusClient = null
        }

        if (!connectionParams.ipAddress) {
          return { success: false, error: 'IP address is required for TCP connection' }
        }
        this.debuggerModbusClient = new ModbusTcpClient({
          host: connectionParams.ipAddress,
          port: 502,
          timeout: 5000,
        })
        await this.debuggerModbusClient.connect()
        this.debuggerTargetIp = connectionParams.ipAddress
      } else {
        if (!connectionParams.port || !connectionParams.baudRate || connectionParams.slaveId === undefined) {
          return { success: false, error: 'Port, baud rate, and slave ID are required for RTU connection' }
        }

        if (
          this.debuggerModbusClient &&
          this.debuggerConnectionType === 'rtu' &&
          this.debuggerRtuPort === connectionParams.port &&
          this.debuggerRtuBaudRate === connectionParams.baudRate &&
          this.debuggerRtuSlaveId === connectionParams.slaveId
        ) {
          this.debuggerReconnecting = false
          return { success: true }
        }

        if (this.debuggerModbusClient) {
          this.debuggerModbusClient.disconnect()
          this.debuggerModbusClient = null
        }

        this.debuggerModbusClient = new ModbusRtuClient({
          port: connectionParams.port,
          baudRate: connectionParams.baudRate,
          slaveId: connectionParams.slaveId,
          timeout: 5000,
        })
        await this.debuggerModbusClient.connect()
        this.debuggerRtuPort = connectionParams.port
        this.debuggerRtuBaudRate = connectionParams.baudRate
        this.debuggerRtuSlaveId = connectionParams.slaveId
      }

      this.debuggerConnectionType = connectionType
      this.debuggerReconnecting = false

      return { success: true }
    } catch (error) {
      this.debuggerModbusClient = null
      this.debuggerWebSocketClient = null
      this.debuggerTargetIp = null
      this.debuggerConnectionType = null
      this.debuggerRtuPort = null
      this.debuggerRtuBaudRate = null
      this.debuggerRtuSlaveId = null
      this.debuggerJwtToken = null
      return { success: false, error: getErrorMessage(error) }
    }
  }

  handleDebuggerDisconnect = (_event: IpcMainInvokeEvent): Promise<{ success: boolean }> => {
    if (this.debuggerModbusClient) {
      this.debuggerModbusClient.disconnect()
      this.debuggerModbusClient = null
    }
    if (this.debuggerWebSocketClient) {
      this.debuggerWebSocketClient.disconnect()
      this.debuggerWebSocketClient = null
    }
    this.debuggerTargetIp = null
    this.debuggerConnectionType = null
    this.debuggerRtuPort = null
    this.debuggerRtuBaudRate = null
    this.debuggerRtuSlaveId = null
    this.debuggerJwtToken = null
    this.debuggerReconnecting = false
    return Promise.resolve({ success: true })
  }

  handleDebuggerSetVariable = async (
    _event: IpcMainInvokeEvent,
    variableIndex: number,
    force: boolean,
    valueBuffer?: Uint8Array,
  ): Promise<{ success: boolean; error?: string }> => {
    const buffer = valueBuffer ? Buffer.from(valueBuffer) : undefined

    if (this.debuggerConnectionType === 'websocket') {
      if (!this.debuggerWebSocketClient) {
        logger.info('[IPC Handler] WebSocket client not connected')
        return { success: false, error: 'Not connected to debugger' }
      }

      try {
        const result = await this.debuggerWebSocketClient.setVariable(variableIndex, force, buffer)
        logger.info('[IPC Handler] WebSocket setVariable result: ' + JSON.stringify(result))
        return result
      } catch (error) {
        logger.error('[IPC Handler] WebSocket setVariable error: ' + getErrorMessage(error))
        return { success: false, error: getErrorMessage(error) }
      }
    }

    if (!this.debuggerModbusClient) {
      logger.info('[IPC Handler] Modbus client not connected')
      return { success: false, error: 'Not connected to debugger' }
    }

    try {
      const result = await this.debuggerModbusClient.setVariable(variableIndex, force, buffer)
      logger.info('[IPC Handler] Modbus setVariable result: ' + JSON.stringify(result))
      return result
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
      this.simulatorModule.stop()
      this.mainWindow?.webContents.send('simulator:stopped')
    }
  }

  // ===================== ETHERCAT DISCOVERY HANDLERS =====================

  handleEtherCATGetInterfaces = async (
    _event: IpcMainInvokeEvent,
    ipAddress: string,
    jwtToken: string,
  ): Promise<{ success: boolean; data?: NetworkInterface[]; error?: string }> => {
    try {
      const result = await this.makeRuntimeApiRequest<{ interfaces: NetworkInterface[] }>(
        ipAddress,
        jwtToken,
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
    jwtToken: string,
  ): Promise<{ success: boolean; data?: EtherCATServiceStatusResponse; error?: string }> => {
    try {
      const result = await this.makeRuntimeApiRequest<EtherCATServiceStatusResponse>(
        ipAddress,
        jwtToken,
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
    jwtToken: string,
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
        jwtToken,
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
    jwtToken: string,
    testRequest: EtherCATTestRequest,
  ): Promise<{ success: boolean; data?: EtherCATTestResponse; error?: string }> => {
    try {
      const postData = JSON.stringify(testRequest)
      const testTimeout = (testRequest.timeout_ms || 3000) + 10000

      const result = await this.makeRuntimeApiPostRequest(
        ipAddress,
        jwtToken,
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
    jwtToken: string,
    validateRequest: EtherCATValidateRequest,
  ): Promise<{ success: boolean; data?: EtherCATValidateResponse; error?: string }> => {
    try {
      const postData = JSON.stringify(validateRequest)

      const result = await this.makeRuntimeApiPostRequest(
        ipAddress,
        jwtToken,
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
    jwtToken: string,
  ): Promise<{ success: boolean; data?: EtherCATRuntimeStatusResponse; error?: string }> => {
    try {
      const postData = JSON.stringify({
        plugin: 'ethercat',
        command: 'status',
      })

      const result = await this.makeRuntimeApiPostRequest(
        ipAddress,
        jwtToken,
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

  handleSimulatorLoadFirmware = async (
    _event: IpcMainInvokeEvent,
    hexPath: string,
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const fs = await import('fs/promises')
      const hexContent = await fs.readFile(hexPath, 'utf-8')
      this.simulatorModule.loadAndRun(hexContent)
      return { success: true }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  }

  handleSimulatorStop = (_event: IpcMainInvokeEvent): Promise<{ success: boolean }> => {
    this.simulatorModule.stop()
    return Promise.resolve({ success: true })
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
    handleUpdateTheme: (_event: unknown, theme?: 'light' | 'dark') => {
      const newTheme = theme ?? (nativeTheme.shouldUseDarkColors ? 'light' : 'dark')
      nativeTheme.themeSource = newTheme
      const appStore = this.store as unknown as { set: (key: string, value: string) => void }
      appStore.set('theme', newTheme)
    },
    createPou: () => this.mainWindow?.webContents.send('pou:createPou', { ok: true }),
  }
}

export default MainProcessBridge
