import { ESIService } from '@root/main/services/esi-service'
import { parseESIDeviceFull } from '@root/main/services/esi-service/esi-parser-main'
import { getProjectPath } from '@root/main/utils'
import type {
  EtherCATScanRequest,
  EtherCATScanResponse,
  EtherCATServiceStatusResponse,
  EtherCATTestRequest,
  EtherCATTestResponse,
  EtherCATValidateRequest,
  EtherCATValidateResponse,
  NetworkInterface,
} from '@root/types/ethercat'
import type { ESIDevice, ESIRepositoryItem, ESIRepositoryItemLight } from '@root/types/ethercat/esi-types'
import { CreatePouFileProps } from '@root/types/IPC/pou-service'
import { CreateProjectFileProps } from '@root/types/IPC/project-service'
import { DeviceConfiguration, DevicePin } from '@root/types/PLC/devices'
import { RuntimeLogEntry } from '@root/types/PLC/runtime-logs'
import { getRuntimeHttpsOptions } from '@root/utils/runtime-https-config'
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { app, nativeTheme, shell } from 'electron'
import type { IncomingMessage } from 'http'
import https from 'https'
import { join } from 'path'
import { platform } from 'process'

import { ProjectState } from '../../../renderer/store/slices'
import { PLCPou, PLCProject } from '../../../types/PLC/open-plc'
import { MainIpcModule, MainIpcModuleConstructor } from '../../contracts/types/modules/ipc/main'
import { logger } from '../../services'
import { ModbusTcpClient } from '../modbus/modbus-client'
import { ModbusRtuClient } from '../modbus/modbus-rtu-client'
import { WebSocketDebugClient } from '../websocket/websocket-debug-client'

type IDataToWrite = {
  projectPath: string
  content: {
    pous: PLCPou[]
    projectData: PLCProject
    deviceConfiguration: DeviceConfiguration
    devicePinMapping: DevicePin[]
  }
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
  private esiService = new ESIService()
  private debuggerModbusClient: ModbusTcpClient | ModbusRtuClient | null = null
  private debuggerWebSocketClient: WebSocketDebugClient | null = null
  private debuggerTargetIp: string | null = null
  private debuggerReconnecting: boolean = false
  private debuggerConnectionType: 'tcp' | 'rtu' | 'websocket' | null = null
  private debuggerRtuPort: string | null = null
  private debuggerRtuBaudRate: number | null = null
  private debuggerRtuSlaveId: number | null = null
  private debuggerJwtToken: string | null = null
  private runtimeCredentials: { ipAddress: string; username: string; password: string } | null = null
  private tokenRefreshInFlight: Promise<{ success: boolean; accessToken?: string; error?: string }> | null = null

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

  handleRuntimeGetUsersInfo = async (_event: IpcMainInvokeEvent, ipAddress: string) => {
    try {
      const url = `https://${ipAddress}:${this.RUNTIME_API_PORT}/api/get-users-info`

      return new Promise((resolve) => {
        const req = https.get(
          url,
          {
            ...getRuntimeHttpsOptions(),
          },
          (res: IncomingMessage) => {
            let data = ''
            res.on('data', (chunk: Buffer) => {
              data += chunk.toString()
            })
            res.on('end', () => {
              // Extract runtime version from response header
              const runtimeVersion = res.headers['x-openplc-runtime-version'] as string | undefined

              if (res.statusCode === 404) {
                resolve({ hasUsers: false, runtimeVersion })
              } else if (res.statusCode === 200) {
                resolve({ hasUsers: true, runtimeVersion })
              } else {
                resolve({ hasUsers: false, error: data || `Unexpected status: ${res.statusCode}`, runtimeVersion })
              }
            })
          },
        )
        req.setTimeout(this.RUNTIME_CONNECTION_TIMEOUT_MS, () => {
          req.destroy()
          resolve({ hasUsers: false, error: 'Connection timeout' })
        })
        req.on('error', (error: Error) => {
          resolve({ hasUsers: false, error: error.message })
        })
      })
    } catch (error) {
      return { hasUsers: false, error: String(error) }
    }
  }

  handleRuntimeCreateUser = async (
    _event: IpcMainInvokeEvent,
    ipAddress: string,
    username: string,
    password: string,
  ) => {
    try {
      const postData = JSON.stringify({ username, password, role: 'user' })

      return new Promise((resolve) => {
        const req = https.request(
          {
            hostname: ipAddress,
            port: this.RUNTIME_API_PORT,
            path: '/api/create-user',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(postData),
            },
            ...getRuntimeHttpsOptions(),
          },
          (res: IncomingMessage) => {
            let data = ''
            res.on('data', (chunk: Buffer) => {
              data += chunk.toString()
            })
            res.on('end', () => {
              if (res.statusCode === 201) {
                resolve({ success: true })
              } else {
                resolve({ success: false, error: data })
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
        req.write(postData)
        req.end()
      })
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  private async performAuthentication(
    ipAddress: string,
    username: string,
    password: string,
  ): Promise<{ success: boolean; accessToken?: string; error?: string }> {
    try {
      const postData = JSON.stringify({ username, password })

      return new Promise((resolve) => {
        const req = https.request(
          {
            hostname: ipAddress,
            port: this.RUNTIME_API_PORT,
            path: '/api/login',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(postData),
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
                  const response = JSON.parse(data) as { access_token: string }
                  resolve({ success: true, accessToken: response.access_token })
                } catch {
                  resolve({ success: false, error: 'Invalid response format' })
                }
              } else {
                resolve({ success: false, error: data })
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
        req.write(postData)
        req.end()
      })
    } catch (error) {
      return { success: false, error: String(error) }
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

  makeRuntimeApiRequest<T = void>(
    ipAddress: string,
    jwtToken: string,
    endpoint: string,
    responseParser?: (data: string) => T,
  ): Promise<{ success: true; data?: T } | { success: false; error: string }> {
    return new Promise((resolve) => {
      const req = https.get(
        `https://${ipAddress}:${this.RUNTIME_API_PORT}${endpoint}`,
        {
          headers: {
            Authorization: `Bearer ${jwtToken}`,
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
              if (responseParser) {
                try {
                  const parsedData = responseParser(data)
                  resolve({ success: true, data: parsedData })
                } catch {
                  resolve({ success: false, error: 'Invalid response format' })
                }
              } else {
                resolve({ success: true })
              }
            } else if (this.isTokenExpiredError(res.statusCode, data)) {
              void this.attemptTokenRefresh().then((refreshResult) => {
                if (refreshResult.success && refreshResult.accessToken) {
                  if (this.mainWindow && this.mainWindow.webContents) {
                    this.mainWindow.webContents.send('runtime:token-refreshed', refreshResult.accessToken)
                  }
                  const retryReq = https.get(
                    `https://${ipAddress}:${this.RUNTIME_API_PORT}${endpoint}`,
                    {
                      headers: {
                        Authorization: `Bearer ${refreshResult.accessToken}`,
                      },
                      ...getRuntimeHttpsOptions(),
                    },
                    (retryRes: IncomingMessage) => {
                      let retryData = ''
                      retryRes.on('data', (chunk: Buffer) => {
                        retryData += chunk.toString()
                      })
                      retryRes.on('end', () => {
                        if (retryRes.statusCode === 200) {
                          if (responseParser) {
                            try {
                              const parsedData = responseParser(retryData)
                              resolve({ success: true, data: parsedData })
                            } catch {
                              resolve({ success: false, error: 'Invalid response format' })
                            }
                          } else {
                            resolve({ success: true })
                          }
                        } else {
                          resolve({ success: false, error: retryData })
                        }
                      })
                    },
                  )
                  retryReq.setTimeout(this.RUNTIME_CONNECTION_TIMEOUT_MS, () => {
                    retryReq.destroy()
                    resolve({ success: false, error: 'Connection timeout' })
                  })
                  retryReq.on('error', (error: Error) => {
                    resolve({ success: false, error: error.message })
                  })
                } else {
                  resolve({
                    success: false,
                    error: refreshResult.error ? `Token refresh failed: ${refreshResult.error}` : data,
                  })
                }
              })
            } else {
              resolve({ success: false, error: data })
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
      return { success: false, error: String(error) }
    }
  }

  handleRuntimeStartPlc = async (_event: IpcMainInvokeEvent, ipAddress: string, jwtToken: string) => {
    try {
      return await this.makeRuntimeApiRequest(ipAddress, jwtToken, '/api/start-plc')
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  handleRuntimeStopPlc = async (_event: IpcMainInvokeEvent, ipAddress: string, jwtToken: string) => {
    try {
      return await this.makeRuntimeApiRequest(ipAddress, jwtToken, '/api/stop-plc')
    } catch (error) {
      return { success: false, error: String(error) }
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
      return { success: false, error: String(error) }
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
      return { success: false, error: String(error) }
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
      return { success: false, error: String(error) }
    }
  }

  // ===================== ETHERCAT DISCOVERY HANDLERS =====================

  /**
   * Get list of network interfaces available for EtherCAT communication
   */
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

  /**
   * Check if EtherCAT discovery service is available on the runtime
   */
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
          const response = JSON.parse(data) as EtherCATServiceStatusResponse
          return response
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

  /**
   * Scan for EtherCAT devices on a network interface
   */
  handleEtherCATScan = async (
    _event: IpcMainInvokeEvent,
    ipAddress: string,
    jwtToken: string,
    scanRequest: EtherCATScanRequest,
  ): Promise<{ success: boolean; data?: EtherCATScanResponse; error?: string }> => {
    try {
      const postData = JSON.stringify(scanRequest)

      return new Promise((resolve) => {
        const req = https.request(
          {
            hostname: ipAddress,
            port: this.RUNTIME_API_PORT,
            path: '/api/discovery/ethercat/scan',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(postData),
              Authorization: `Bearer ${jwtToken}`,
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
                  const response = JSON.parse(data) as EtherCATScanResponse
                  resolve({ success: true, data: response })
                } catch {
                  resolve({ success: false, error: 'Invalid response format' })
                }
              } else if (res.statusCode === 403) {
                resolve({ success: false, error: 'Permission denied - CAP_NET_RAW required' })
              } else if (res.statusCode === 404) {
                resolve({ success: false, error: 'Interface not found' })
              } else if (res.statusCode === 503) {
                resolve({ success: false, error: 'Discovery service not available' })
              } else if (res.statusCode === 504) {
                resolve({ success: false, error: 'Scan timeout' })
              } else {
                resolve({ success: false, error: data || `Unexpected status: ${res.statusCode}` })
              }
            })
          },
        )
        // Use longer timeout for scan operations (scan timeout + buffer)
        const scanTimeout = (scanRequest.timeout_ms || 5000) + 10000
        req.setTimeout(scanTimeout, () => {
          req.destroy()
          resolve({ success: false, error: 'Connection timeout' })
        })
        req.on('error', (error: Error) => {
          resolve({ success: false, error: error.message })
        })
        req.write(postData)
        req.end()
      })
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  /**
   * Test connection to a specific EtherCAT slave
   */
  handleEtherCATTest = async (
    _event: IpcMainInvokeEvent,
    ipAddress: string,
    jwtToken: string,
    testRequest: EtherCATTestRequest,
  ): Promise<{ success: boolean; data?: EtherCATTestResponse; error?: string }> => {
    try {
      const postData = JSON.stringify(testRequest)

      return new Promise((resolve) => {
        const req = https.request(
          {
            hostname: ipAddress,
            port: this.RUNTIME_API_PORT,
            path: '/api/discovery/ethercat/test',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(postData),
              Authorization: `Bearer ${jwtToken}`,
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
                  const response = JSON.parse(data) as EtherCATTestResponse
                  resolve({ success: true, data: response })
                } catch {
                  resolve({ success: false, error: 'Invalid response format' })
                }
              } else if (res.statusCode === 403) {
                resolve({ success: false, error: 'Permission denied - CAP_NET_RAW required' })
              } else if (res.statusCode === 404) {
                resolve({ success: false, error: 'Interface not found' })
              } else if (res.statusCode === 503) {
                resolve({ success: false, error: 'Discovery service not available' })
              } else if (res.statusCode === 504) {
                resolve({ success: false, error: 'Connection test timeout' })
              } else {
                resolve({ success: false, error: data || `Unexpected status: ${res.statusCode}` })
              }
            })
          },
        )
        const testTimeout = (testRequest.timeout_ms || 3000) + 10000
        req.setTimeout(testTimeout, () => {
          req.destroy()
          resolve({ success: false, error: 'Connection timeout' })
        })
        req.on('error', (error: Error) => {
          resolve({ success: false, error: error.message })
        })
        req.write(postData)
        req.end()
      })
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  /**
   * Validate an EtherCAT configuration
   */
  handleEtherCATValidate = async (
    _event: IpcMainInvokeEvent,
    ipAddress: string,
    jwtToken: string,
    validateRequest: EtherCATValidateRequest,
  ): Promise<{ success: boolean; data?: EtherCATValidateResponse; error?: string }> => {
    try {
      const postData = JSON.stringify(validateRequest)

      return new Promise((resolve) => {
        const req = https.request(
          {
            hostname: ipAddress,
            port: this.RUNTIME_API_PORT,
            path: '/api/discovery/ethercat/validate',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(postData),
              Authorization: `Bearer ${jwtToken}`,
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
                  const response = JSON.parse(data) as EtherCATValidateResponse
                  resolve({ success: true, data: response })
                } catch {
                  resolve({ success: false, error: 'Invalid response format' })
                }
              } else if (res.statusCode === 400) {
                resolve({ success: false, error: 'Invalid configuration format' })
              } else {
                resolve({ success: false, error: data || `Unexpected status: ${res.statusCode}` })
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
        req.write(postData)
        req.end()
      })
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  // ===================== ESI REPOSITORY HANDLERS =====================

  /**
   * Load ESI repository index from project
   */
  handleESILoadRepositoryIndex = async (
    _event: IpcMainInvokeEvent,
    projectPath: string,
  ): Promise<{
    success: boolean
    data?: {
      version: number
      items: Array<{
        id: string
        filename: string
        vendorId: string
        vendorName: string
        deviceCount: number
        loadedAt: number
        warnings?: string[]
      }>
    } | null
    error?: string
  }> => {
    try {
      const index = await this.esiService.loadRepositoryIndex(projectPath)
      return { success: true, data: index }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  /**
   * Save ESI repository index to project
   */
  handleESISaveRepositoryIndex = async (
    _event: IpcMainInvokeEvent,
    projectPath: string,
    items: ESIRepositoryItem[],
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      return await this.esiService.saveRepositoryIndex(projectPath, items)
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  /**
   * Save an ESI XML file to project
   */
  handleESISaveXmlFile = async (
    _event: IpcMainInvokeEvent,
    projectPath: string,
    itemId: string,
    xmlContent: string,
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      return await this.esiService.saveXmlFile(projectPath, itemId, xmlContent)
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  /**
   * Load an ESI XML file from project
   */
  handleESILoadXmlFile = async (
    _event: IpcMainInvokeEvent,
    projectPath: string,
    itemId: string,
  ): Promise<{ success: boolean; content?: string; error?: string }> => {
    try {
      return await this.esiService.loadXmlFile(projectPath, itemId)
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  /**
   * Delete an ESI XML file from project
   */
  handleESIDeleteXmlFile = async (
    _event: IpcMainInvokeEvent,
    projectPath: string,
    itemId: string,
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      return await this.esiService.deleteXmlFile(projectPath, itemId)
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  /**
   * Save a complete ESI repository item (XML + update index)
   */
  handleESISaveRepositoryItem = async (
    _event: IpcMainInvokeEvent,
    projectPath: string,
    item: ESIRepositoryItem,
    xmlContent: string,
    existingItems: ESIRepositoryItem[],
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      return await this.esiService.saveRepositoryItem(projectPath, item, xmlContent, existingItems)
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  /**
   * Delete an ESI repository item (XML + update index)
   */
  handleESIDeleteRepositoryItem = async (
    _event: IpcMainInvokeEvent,
    projectPath: string,
    itemId: string,
    existingItems: ESIRepositoryItem[],
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      return await this.esiService.deleteRepositoryItem(projectPath, itemId, existingItems)
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  // ===================== ESI OPTIMIZED HANDLERS =====================

  /**
   * Parse and save a single ESI file
   */
  handleESIParseAndSaveFile = async (
    _event: IpcMainInvokeEvent,
    projectPath: string,
    filename: string,
    content: string,
  ): Promise<{ success: boolean; item?: ESIRepositoryItemLight; error?: string }> => {
    return this.esiService.parseAndSaveFile(projectPath, filename, content)
  }

  /**
   * Clear the entire ESI repository
   */
  handleESIClearRepository = async (
    _event: IpcMainInvokeEvent,
    projectPath: string,
  ): Promise<{ success: boolean; error?: string }> => {
    return this.esiService.clearRepository(projectPath)
  }

  /**
   * Load a full ESI device on-demand (with PDOs, SM, FMMU)
   */
  handleESILoadDeviceFull = async (
    _event: IpcMainInvokeEvent,
    projectPath: string,
    itemId: string,
    deviceIndex: number,
  ): Promise<{ success: boolean; device?: ESIDevice; error?: string }> => {
    try {
      const xmlResult = await this.esiService.loadXmlFile(projectPath, itemId)
      if (!xmlResult.success || !xmlResult.content) {
        return { success: false, error: xmlResult.error || 'XML file not found' }
      }

      const result = parseESIDeviceFull(xmlResult.content, deviceIndex)
      return result
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  /**
   * Load repository as lightweight items (instant from v2 cache)
   */
  handleESILoadRepositoryLight = async (
    _event: IpcMainInvokeEvent,
    projectPath: string,
  ): Promise<{ success: boolean; items?: ESIRepositoryItemLight[]; needsMigration?: boolean; error?: string }> => {
    try {
      return await this.esiService.loadRepositoryLight(projectPath)
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  /**
   * Migrate v1 repository to v2 with device summaries
   */
  handleESIMigrateRepository = async (
    _event: IpcMainInvokeEvent,
    projectPath: string,
  ): Promise<{ success: boolean; items?: ESIRepositoryItemLight[]; error?: string }> => {
    try {
      return await this.esiService.migrateRepositoryToV2(projectPath)
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  // ===================== IPC HANDLER REGISTRATION =====================
  setupMainIpcListener() {
    // Project-related handlers
    this.ipcMain.handle('project:create', this.handleProjectCreate)
    this.ipcMain.handle('project:open', this.handleProjectOpen)
    this.ipcMain.handle('project:path-picker', this.handleProjectPathPicker)
    this.ipcMain.handle('project:save', this.handleProjectSave)
    this.ipcMain.handle('project:save-file', this.handleFileSave)
    this.ipcMain.handle('project:open-by-path', this.handleProjectOpenByPath)

    // Pou-related handlers
    this.ipcMain.handle('pou:create', this.handleCreatePouFile)
    this.ipcMain.handle('pou:delete', this.handleDeletePouFile)
    this.ipcMain.handle('pou:rename', this.handleRenamePouFile)

    // App and system handlers
    this.ipcMain.handle('open-external-link', this.handleOpenExternalLink)
    this.ipcMain.handle('system:get-system-info', this.handleGetSystemInfo)
    this.ipcMain.handle('app:store-retrieve-recent', this.handleStoreRetrieveRecent)
    this.ipcMain.on('app:quit', this.handleAppQuit)
    // this.ipcMain.on('app:reply-if-app-is-closing', (_, shouldQuit) => { ... })

    // Theme and store handlers
    this.ipcMain.on('system:update-theme', this.mainIpcEventHandlers.handleUpdateTheme)
    // this.ipcMain.handle('app:store-get', this.mainIpcEventHandlers.getStoreValue)

    // ===================== COMPILER SERVICE =====================
    // TODO: This handle should be refactored to use MessagePortMain for better performance.
    this.ipcMain.handle('compiler:export-project-xml', this.handleCompilerExportProjectXml)
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
    this.ipcMain.handle('hardware:get-available-communication-ports', this.handleHardwareGetAvailableCommunicationPorts)
    this.ipcMain.handle('hardware:get-available-boards', this.handleHardwareGetAvailableBoards)
    this.ipcMain.handle('hardware:refresh-communication-ports', this.handleHardwareRefreshCommunicationPorts)
    this.ipcMain.handle('hardware:refresh-available-boards', this.handleHardwareRefreshAvailableBoards)

    // ===================== UTILITIES =====================
    this.ipcMain.handle('util:get-preview-image', this.handleUtilGetPreviewImage)
    this.ipcMain.on('util:log', this.handleUtilLog)
    this.ipcMain.handle('util:read-debug-file', this.handleReadDebugFile)

    // ===================== DEBUGGER =====================
    this.ipcMain.handle('debugger:verify-md5', this.handleDebuggerVerifyMd5)
    this.ipcMain.handle('debugger:read-program-st-md5', this.handleReadProgramStMd5)
    this.ipcMain.handle('debugger:get-variables-list', this.handleDebuggerGetVariablesList)
    this.ipcMain.handle('debugger:set-variable', this.handleDebuggerSetVariable)
    this.ipcMain.handle('debugger:connect', this.handleDebuggerConnect)
    this.ipcMain.handle('debugger:disconnect', this.handleDebuggerDisconnect)

    // ===================== RUNTIME API =====================
    this.ipcMain.handle('runtime:get-users-info', this.handleRuntimeGetUsersInfo)
    this.ipcMain.handle('runtime:create-user', this.handleRuntimeCreateUser)
    this.ipcMain.handle('runtime:login', this.handleRuntimeLogin)
    this.ipcMain.handle('runtime:get-status', this.handleRuntimeGetStatus)
    this.ipcMain.handle('runtime:start-plc', this.handleRuntimeStartPlc)
    this.ipcMain.handle('runtime:stop-plc', this.handleRuntimeStopPlc)
    this.ipcMain.handle('runtime:get-compilation-status', this.handleRuntimeGetCompilationStatus)
    this.ipcMain.handle('runtime:get-logs', this.handleRuntimeGetLogs)
    this.ipcMain.handle('runtime:clear-credentials', this.handleRuntimeClearCredentials)
    this.ipcMain.handle('runtime:get-serial-ports', this.handleRuntimeGetSerialPorts)

    // ===================== ETHERCAT DISCOVERY =====================
    this.ipcMain.handle('ethercat:get-interfaces', this.handleEtherCATGetInterfaces)
    this.ipcMain.handle('ethercat:get-status', this.handleEtherCATGetStatus)
    this.ipcMain.handle('ethercat:scan', this.handleEtherCATScan)
    this.ipcMain.handle('ethercat:test', this.handleEtherCATTest)
    this.ipcMain.handle('ethercat:validate', this.handleEtherCATValidate)

    // ===================== ESI REPOSITORY =====================
    this.ipcMain.handle('esi:load-repository-index', this.handleESILoadRepositoryIndex)
    this.ipcMain.handle('esi:save-repository-index', this.handleESISaveRepositoryIndex)
    this.ipcMain.handle('esi:save-xml-file', this.handleESISaveXmlFile)
    this.ipcMain.handle('esi:load-xml-file', this.handleESILoadXmlFile)
    this.ipcMain.handle('esi:delete-xml-file', this.handleESIDeleteXmlFile)
    this.ipcMain.handle('esi:save-repository-item', this.handleESISaveRepositoryItem)
    this.ipcMain.handle('esi:delete-repository-item', this.handleESIDeleteRepositoryItem)

    // ===================== ESI OPTIMIZED (v2) =====================
    this.ipcMain.handle('esi:parse-and-save-file', this.handleESIParseAndSaveFile)
    this.ipcMain.handle('esi:clear-repository', this.handleESIClearRepository)
    this.ipcMain.handle('esi:load-device-full', this.handleESILoadDeviceFull)
    this.ipcMain.handle('esi:load-repository-light', this.handleESILoadRepositoryLight)
    this.ipcMain.handle('esi:migrate-repository', this.handleESIMigrateRepository)
  }

  // ===================== HANDLER METHODS =====================
  // Project-related handlers
  handleProjectCreate = async (_event: IpcMainInvokeEvent, data: CreateProjectFileProps) => {
    const response = await this.projectService.createProject(data)
    return response
  }
  handleProjectOpen = async () => {
    const response = await this.projectService.openProject()
    return response
  }
  handleProjectPathPicker = async (_event: IpcMainInvokeEvent) => {
    const windowManager = this.mainWindow
    try {
      if (windowManager) {
        const res = await getProjectPath(windowManager)
        return res
      }
      console.error('Window object not defined')
    } catch (error) {
      console.error('Error getting project path:', error)
    }
  }
  handleFileSave = async (_event: IpcMainInvokeEvent, filePath: string, content: unknown) =>
    await this.projectService.saveFile(filePath, content)
  handleProjectSave = (_event: IpcMainInvokeEvent, { projectPath, content }: IDataToWrite) =>
    this.projectService.saveProject({ projectPath, content })
  handleProjectOpenByPath = async (_event: IpcMainInvokeEvent, projectPath: string) => {
    try {
      const response = await this.projectService.openProjectByPath(projectPath)
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

  // Pou-related handlers
  handleCreatePouFile = async (_event: IpcMainInvokeEvent, props: CreatePouFileProps) => {
    try {
      const response = await this.pouService.createPouFile(props)
      return response
    } catch (error) {
      console.error('Error creating POU file:', error)
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
      console.error('Error deleting POU file:', error)
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
      console.error('Error renaming POU file:', error)
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
      console.error('Error opening external link:', error)
      return { success: false, error }
    }
  }
  handleGetSystemInfo = () => {
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
      console.error('Error reading history file:', error)
      return []
    }
  }
  handleAppQuit = () => {
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
    dataToCreateXml: ProjectState['data'],
    xmlFormatTarget: 'old-editor' | 'codesys',
  ) => this.compilerModule.createXmlFile(pathToUserProject, dataToCreateXml, xmlFormatTarget)

  handleRunCompileProgram = (event: IpcMainEvent, args: Array<string | ProjectState['data']>) => {
    const mainProcessPort = event.ports[0]
    void this.compilerModule.compileProgram(args, mainProcessPort, this)
  }

  handleRunDebugCompilation = (event: IpcMainEvent, args: Array<string | ProjectState['data']>) => {
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
  //   dataToCreateXml: ProjectState['data'],
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
  handleWindowReload = () => this.mainWindow?.webContents.reload()
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
    connectionType: 'tcp' | 'rtu' | 'websocket',
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
      if (connectionType === 'websocket') {
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
          return { success: false, error: `Failed to reconnect: ${String(error)}`, needsReconnect: true }
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
        return { success: false, error: String(error), needsReconnect: true }
      }
    }

    if (!this.debuggerModbusClient) {
      if (this.debuggerReconnecting) {
        return { success: false, error: 'Reconnection in progress', needsReconnect: true }
      }

      this.debuggerReconnecting = true
      try {
        if (this.debuggerConnectionType === 'tcp') {
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
        return { success: false, error: `Failed to reconnect: ${String(error)}`, needsReconnect: true }
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
      return { success: false, error: String(error), needsReconnect: true }
    }
  }

  handleDebuggerConnect = async (
    _event: IpcMainInvokeEvent,
    connectionType: 'tcp' | 'rtu' | 'websocket',
    connectionParams: {
      ipAddress?: string
      port?: string
      baudRate?: number
      slaveId?: number
      jwtToken?: string
    },
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      if (connectionType === 'websocket') {
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
      return { success: false, error: String(error) }
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
        console.log('[IPC Handler] WebSocket client not connected')
        return { success: false, error: 'Not connected to debugger' }
      }

      try {
        const result = await this.debuggerWebSocketClient.setVariable(variableIndex, force, buffer)
        console.log('[IPC Handler] WebSocket setVariable result:', result)
        return result
      } catch (error) {
        console.error('[IPC Handler] WebSocket setVariable error:', error)
        return { success: false, error: String(error) }
      }
    }

    if (!this.debuggerModbusClient) {
      console.log('[IPC Handler] Modbus client not connected')
      return { success: false, error: 'Not connected to debugger' }
    }

    try {
      const result = await this.debuggerModbusClient.setVariable(variableIndex, force, buffer)
      console.log('[IPC Handler] Modbus setVariable result:', result)
      return result
    } catch (error) {
      console.error('[IPC Handler] Modbus setVariable error:', error)
      return { success: false, error: String(error) }
    }
  }

  // ===================== EVENT HANDLERS =====================
  mainIpcEventHandlers = {
    handleUpdateTheme: () => {
      nativeTheme.themeSource = nativeTheme.shouldUseDarkColors ? 'light' : 'dark'
    },
    createPou: () => this.mainWindow?.webContents.send('pou:createPou', { ok: true }),
  }
}

export default MainProcessBridge
