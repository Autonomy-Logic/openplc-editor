import https from 'node:https'

import { getRuntimeHttpsOptions } from '@root/backend/editor/utils/runtime-https-config'
import { getErrorMessage } from '@root/frontend/utils/get-error-message'
import { z } from 'zod'

export const BOOTLOADER_API_PORT = 8445

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024

const CapabilitiesSchema = z.object({
  service: z.string(),
  bootloaderVersion: z.string().optional(),
  runtimeVersion: z.string().optional(),
  state: z.string(),
  recovery: z.boolean(),
})

const LoginSchema = z.object({
  access_token: z.string(),
  role: z.string().optional(),
})

const StatusSchema = z.object({
  state: z.string(),
  reason: z.string().optional(),
  since: z.string().optional(),
  crashCount: z.number().optional(),
  healthSource: z.string().optional(),
  containerId: z.string().optional(),
  containerName: z.string().optional(),
  image: z.string().optional(),
  runtimeVersion: z.string().optional(),
  recovery: z.boolean().optional(),
})

const DeviceInfoSchema = z.object({
  hostname: z.string().optional(),
  architecture: z.string().optional(),
  kernel: z.string().optional(),
  system: z.string().optional(),
  cpus: z.number().optional(),
  memoryBytes: z.number().optional(),
  dockerVersion: z.string().optional(),
})

const LogsSchema = z.object({
  logs: z.string(),
  available: z.boolean(),
  reason: z.string().optional(),
  tail: z.number().optional(),
})

const UpdateProgressSchema = z.object({
  state: z.string(),
  from: z.string().optional(),
  to: z.string().optional(),
  phase: z.string().optional(),
  percent: z.number().nullable().optional(),
  error: z.string().optional(),
  startedAt: z.string().optional(),
  finishedAt: z.string().nullable().optional(),
})
import type {
  BootloaderApiResult,
  BootloaderCapabilities,
  BootloaderCapabilitiesOptions,
  BootloaderLogs,
  BootloaderStatus,
  BootloaderUpdateProgress,
  RuntimeDeviceInfo,
} from '@root/middleware/shared/ports/runtime-port'

const _contract: {
  capabilities: z.ZodType<BootloaderCapabilities>
  status: z.ZodType<BootloaderStatus>
  deviceInfo: z.ZodType<RuntimeDeviceInfo>
  logs: z.ZodType<BootloaderLogs>
  progress: z.ZodType<BootloaderUpdateProgress>
} = {
  capabilities: CapabilitiesSchema,
  status: StatusSchema,
  deviceInfo: DeviceInfoSchema,
  logs: LogsSchema,
  progress: UpdateProgressSchema,
}
void _contract

export type {
  BootloaderApiResult,
  BootloaderCapabilities,
  BootloaderCapabilitiesOptions,
  BootloaderLogs,
  BootloaderStatus,
  BootloaderUpdateProgress,
  RuntimeDeviceInfo,
} from '@root/middleware/shared/ports/runtime-port'

const ErrorSchema = z.object({ error: z.string() })

const ConflictSchema = z.object({
  error: z.string(),
  progress: UpdateProgressSchema.optional(),
})

type RequestOptions = {
  method: 'GET' | 'POST'
  path: string
  body?: string
  token?: string
  timeoutMs?: number
  /** Return a 409 body as a success instead of an error. */
  treatConflictAsSuccess?: boolean
}

const BARE_HOST =
  /^(?:\[[0-9a-fA-F:]+\]|[0-9a-fA-F:]+|[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)$/

const isDialableHost = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 253 && BARE_HOST.test(value)

const CAPABILITIES_TIMEOUT_MS = 4000

const MIN_CAPABILITIES_TIMEOUT_MS = 500
const MAX_CAPABILITIES_TIMEOUT_MS = 8000

/**
 * The capability request timeout carried by untrusted `options`.
 *
 * @returns `options.timeoutMs` when it is an integer from 500 to 8000 ms, otherwise `undefined`.
 */
export function capabilitiesTimeoutMs(options: unknown): number | undefined {
  if (typeof options !== 'object' || options === null || !('timeoutMs' in options)) return undefined
  const { timeoutMs } = options
  if (typeof timeoutMs !== 'number' || !Number.isInteger(timeoutMs)) return undefined
  return timeoutMs >= MIN_CAPABILITIES_TIMEOUT_MS && timeoutMs <= MAX_CAPABILITIES_TIMEOUT_MS ? timeoutMs : undefined
}

export class BootloaderApiClient {
  private readonly port = BOOTLOADER_API_PORT

  /** Default request timeout, in milliseconds. */
  private readonly DEFAULT_TIMEOUT_MS = 8000

  /** Login request timeout, in milliseconds. */
  private readonly LOGIN_TIMEOUT_MS = 20000

  /** The bootloader session, held per device address. */
  private tokens = new Map<string, string>()

  /** Forget a device's session, on logout or a deliberate disconnect. */
  clearSession(ipAddress?: string): void {
    if (ipAddress) {
      this.tokens.delete(ipAddress)
      return
    }
    this.tokens.clear()
  }

  /**
   * Whether a bootloader answers on this device, asked without authentication. A refusal or a timeout means no
   * bootloader.
   */
  async getCapabilities(
    ipAddress: string,
    options?: BootloaderCapabilitiesOptions,
  ): Promise<BootloaderApiResult<BootloaderCapabilities>> {
    const result = await this.request(ipAddress, {
      method: 'GET',
      path: '/api/bootloader/capabilities',
      timeoutMs: capabilitiesTimeoutMs(options) ?? CAPABILITIES_TIMEOUT_MS,
    })
    if (!result.success) return result
    return this.parse(CapabilitiesSchema, result.data)
  }

  /** Log in and remember the token for subsequent calls. */
  async login(ipAddress: string, username: string, password: string): Promise<BootloaderApiResult<{ role?: string }>> {
    const result = await this.request(ipAddress, {
      method: 'POST',
      path: '/api/bootloader/login',
      body: JSON.stringify({ username, password }),
      timeoutMs: this.LOGIN_TIMEOUT_MS,
    })
    if (!result.success) return result

    const parsed = this.parse(LoginSchema, result.data)
    if (!parsed.success) return parsed

    this.tokens.set(ipAddress, parsed.data.access_token)
    return { success: true, data: { role: parsed.data.role } }
  }

  async getStatus(ipAddress: string): Promise<BootloaderApiResult<BootloaderStatus>> {
    const result = await this.authenticated(ipAddress, { method: 'GET', path: '/api/bootloader/status' })
    if (!result.success) return result
    return this.parse(StatusSchema, result.data)
  }

  async getDeviceInfo(ipAddress: string): Promise<BootloaderApiResult<RuntimeDeviceInfo>> {
    const result = await this.authenticated(ipAddress, { method: 'GET', path: '/api/bootloader/device-info' })
    if (!result.success) return result
    return this.parse(DeviceInfoSchema, result.data)
  }

  /** The runtime container's recent output. */
  async getRuntimeLogs(ipAddress: string, tail = 200): Promise<BootloaderApiResult<BootloaderLogs>> {
    const result = await this.authenticated(ipAddress, {
      method: 'GET',
      path: `/api/bootloader/logs?tail=${encodeURIComponent(String(tail))}`,
      timeoutMs: 20000,
    })
    if (!result.success) return result
    return this.parse(LogsSchema, result.data)
  }

  /** Ask for a version change. Returns as soon as the work is under way; progress is read with `getUpdateProgress`. */
  async startUpdate(ipAddress: string, version: string): Promise<BootloaderApiResult<BootloaderUpdateProgress>> {
    const result = await this.authenticated(ipAddress, {
      method: 'POST',
      path: '/api/bootloader/update',
      body: JSON.stringify({ version }),
      timeoutMs: 20000,
      treatConflictAsSuccess: true,
    })
    if (!result.success) return result

    const accepted = z.object({ progress: UpdateProgressSchema.optional() })
    const parsed = this.parse(accepted, result.data)
    if (!parsed.success) return parsed
    return { success: true, data: parsed.data.progress ?? { state: 'pulling', to: version } }
  }

  async getUpdateProgress(ipAddress: string): Promise<BootloaderApiResult<BootloaderUpdateProgress>> {
    const result = await this.authenticated(ipAddress, { method: 'GET', path: '/api/bootloader/update' })
    if (!result.success) return result
    return this.parse(UpdateProgressSchema, result.data)
  }

  /** Stop and start the runtime container. */
  async restartRuntime(ipAddress: string): Promise<BootloaderApiResult<{ state?: string; reason?: string }>> {
    const result = await this.authenticated(ipAddress, {
      method: 'POST',
      path: '/api/bootloader/restart',
      body: JSON.stringify({}),
      timeoutMs: 120000,
    })
    if (!result.success) return result
    return this.parse(z.object({ state: z.string().optional(), reason: z.string().optional() }), result.data)
  }

  /** Attach the stored token, failing clearly when there is not one. */
  private async authenticated(
    ipAddress: string,
    options: Omit<RequestOptions, 'token'>,
  ): Promise<BootloaderApiResult<string>> {
    const token = this.tokens.get(ipAddress)
    if (!token) {
      return { success: false, error: 'Not signed in to the bootloader on this device' }
    }
    const result = await this.request(ipAddress, { ...options, token })
    if (!result.success && /\b401\b|expired|invalid token/i.test(result.error)) {
      this.tokens.delete(ipAddress)
    }
    return result
  }

  private parse<T>(schema: z.ZodType<T>, raw: string): BootloaderApiResult<T> {
    try {
      return { success: true, data: schema.parse(JSON.parse(raw)) }
    } catch (error) {
      return {
        success: false,
        error: `The bootloader sent a response this editor does not understand: ${getErrorMessage(error)}`,
      }
    }
  }

  private request(ipAddress: string, options: RequestOptions): Promise<BootloaderApiResult<string>> {
    if (!isDialableHost(ipAddress)) {
      return Promise.resolve({
        success: false,
        error: 'That is not a device address this editor will connect to',
      })
    }
    return new Promise((resolve) => {
      const timeout = options.timeoutMs ?? this.DEFAULT_TIMEOUT_MS
      const headers: Record<string, string> = { Accept: 'application/json' }
      if (options.body !== undefined) {
        headers['Content-Type'] = 'application/json'
        headers['Content-Length'] = String(Buffer.byteLength(options.body))
      }
      if (options.token) {
        headers.Authorization = `Bearer ${options.token}`
      }

      const request = https.request(
        {
          hostname: ipAddress,
          port: this.port,
          path: options.path,
          method: options.method,
          headers,
          timeout,
          ...getRuntimeHttpsOptions(),
        },
        (response) => {
          let data = ''
          let received = 0
          response.on('data', (chunk: Buffer | string) => {
            received += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
            if (received > MAX_RESPONSE_BYTES) {
              request.destroy()
              resolve({
                success: false,
                error:
                  `The bootloader on ${ipAddress}:${this.port} sent more than ` +
                  `${Math.round(MAX_RESPONSE_BYTES / 1024 / 1024)} MB; the response was discarded.`,
              })
              return
            }
            data += chunk
          })
          response.on('end', () => {
            const status = response.statusCode ?? 0
            if (status >= 200 && status < 300) {
              resolve({ success: true, data })
              return
            }
            if (status === 409 && options.treatConflictAsSuccess === true) {
              resolve({ success: true, data })
              return
            }
            resolve({ success: false, error: this.describeFailure(status, data) })
          })
        },
      )

      const onTimeout = () => {
        request.destroy()
        resolve({
          success: false,
          error: `The bootloader on ${ipAddress}:${this.port} did not respond within ${timeout / 1000}s`,
        })
      }
      const handshakeTimer = setTimeout(onTimeout, timeout)
      request.on('socket', (socket) => {
        if (request.reusedSocket) {
          clearTimeout(handshakeTimer)
          return
        }
        socket.once('secureConnect', () => clearTimeout(handshakeTimer))
      })
      request.on('close', () => clearTimeout(handshakeTimer))
      request.on('timeout', onTimeout)
      request.on('error', (error) => {
        resolve({ success: false, error: getErrorMessage(error) })
      })

      if (options.body !== undefined) request.write(options.body)
      request.end()
    })
  }

  /** Turn a non-2xx response into an error carrying the bootloader's own message. A 409 keeps its progress payload. */
  private describeFailure(status: number, body: string): string {
    try {
      if (status === 409) {
        const conflict = ConflictSchema.parse(JSON.parse(body))
        return conflict.error
      }
      return ErrorSchema.parse(JSON.parse(body)).error
    } catch {
      if (status === 401) return 'The bootloader rejected these credentials'
      if (status === 0) return 'No response from the bootloader'
      return `The bootloader returned HTTP ${status}`
    }
  }
}
