import type { IncomingHttpHeaders, IncomingMessage } from 'node:http'
import https from 'node:https'

import { getRuntimeHttpsOptions } from '@root/backend/editor/utils/runtime-https-config'
import type { PlcControlResult } from '@root/backend/shared/debug/types'
import { SNAPSHOT_LIMITS } from '@root/backend/shared/project/project-snapshot-archive'
import { PlcRuntimeState } from '@root/backend/shared/simulator/types'
import { getErrorMessage } from '@root/frontend/utils/get-error-message'
import type { UsersInfoRawFacts, UsersInfoResult } from '@root/middleware/shared/ports/runtime-port'
import {
  createRuntimeTokenManager,
  type RuntimeTokenManager,
} from '@root/middleware/shared/runtime-auth/runtime-token-manager'
import { usersInfoFromFacts } from '@root/middleware/shared/utils/runtime-provisioning'
import { z } from 'zod'

export const RUNTIME_API_PORT = 8443

export type RuntimeApiResult<T> = { success: true; data?: T } | { success: false; error: string }

const LoginResponseSchema = z.object({ access_token: z.string() })

const PlcStatusResponseSchema = z.object({
  status: z.string().optional(),
  switchPosition: z.string().optional(),
})

const ProjectSnapshotBodySchema = z.object({
  projectName: z.string(),
  contentBase64: z.string(),
})

type ProjectSnapshotBody = z.infer<typeof ProjectSnapshotBodySchema>

const MAX_SNAPSHOT_RESPONSE_BYTES = Math.ceil(SNAPSHOT_LIMITS.maxTotalBytes * (4 / 3)) + 1024 * 1024

function describeSnapshotFetchFailure(raw: string, statusCode?: number): string {
  if (statusCode === 403) {
    return 'This account is not an administrator on that device. Only administrators can retrieve a stored project.'
  }
  if (statusCode === 404) {
    return 'That device is not storing a project.'
  }
  return raw
}

/** The first value of a header that arrives as a string, an array or `undefined`. */
function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value[0]
  return undefined
}

/** Parse JSON without throwing; `null` for anything unparseable. */
function parseJsonOrNull(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** The reason an upload was refused, or null when it was accepted. A body that does not parse is not a refusal. */
export function readUploadRefusal(responseBody: string): string | null {
  const parsed = parseJsonOrNull(responseBody)
  if (typeof parsed !== 'object' || parsed === null) return null
  const refusal = (parsed as Record<string, unknown>).UploadFileFail
  return typeof refusal === 'string' && refusal !== '' ? refusal : null
}

/** A `Uint8Array` view over a `Buffer`'s bytes — no copy. */
function asBytes(buffer: Buffer): Uint8Array {
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
}

/** Replaces CR, LF, `"` and `\` with `_` so a value is safe to interpolate into a multipart header. */
function headerSafe(value: string): string {
  return value.replace(/[\r\n"\\]/g, '_')
}

/** Raised by `httpRequest` when its own connection timer fires. */
class RuntimeConnectionTimeoutError extends Error {
  constructor() {
    super('Connection timeout')
    this.name = 'RuntimeConnectionTimeoutError'
  }
}

/** The string `code` of a Node request error, when it carries one. */
function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
}

export class RuntimeApiClient {
  private readonly RUNTIME_API_PORT = RUNTIME_API_PORT
  private readonly RUNTIME_CONNECTION_TIMEOUT_MS = 5000
  private readonly RUNTIME_LOGIN_TIMEOUT_MS = 15000

  /** Address of the runtime this session is authenticated against. */
  private runtimeIp: string | null = null

  /**
   * Single token authority: owns the access token + credentials and the
   * refresh/retry-on-401 logic, shared byte-for-byte with the web app.
   */
  readonly tokens: RuntimeTokenManager = createRuntimeTokenManager({
    login: async (credentials) => {
      if (!this.runtimeIp) return { success: false, error: 'No runtime address configured' }
      const result = await this.performAuthentication(this.runtimeIp, credentials.username, credentials.password)
      return { success: result.success, token: result.accessToken, error: result.error }
    },
  })

  /** The address the token authority will re-authenticate against. */
  setAddress(ipAddress: string): void {
    this.runtimeIp = ipAddress
  }

  getAddress(): string | null {
    return this.runtimeIp
  }

  /** Log in and adopt the session. */
  async login(
    ipAddress: string,
    username: string,
    password: string,
  ): Promise<{ success: boolean; accessToken?: string; error?: string }> {
    const result = await this.performAuthentication(ipAddress, username, password)
    if (result.success && result.accessToken) {
      this.runtimeIp = ipAddress
      this.tokens.setSession(result.accessToken, { username, password })
    }
    return result
  }

  /**
   * Whether this runtime has any user account yet (a 404 means none), with the runtime version read from a response
   * header.
   */
  async getUsersInfo(address: string): Promise<UsersInfoResult> {
    return usersInfoFromFacts(await this.getUsersInfoFacts(address))
  }

  /**
   * The raw outcome of `GET /api/get-users-info`: the response as received, or
   * the request error with its Node `code` and whether this client's own
   * connection timer fired.
   */
  async getUsersInfoFacts(address: string): Promise<UsersInfoRawFacts> {
    try {
      const res = await this.httpRequest({ method: 'GET', url: this.runtimeUrl(address, '/api/get-users-info') })
      return {
        kind: 'response',
        statusCode: res.statusCode,
        body: res.data,
        runtimeVersion: firstHeaderValue(res.headers['x-openplc-runtime-version']),
      }
    } catch (error) {
      return {
        kind: 'error',
        code: errorCode(error),
        message: getErrorMessage(error),
        timedOut: error instanceof RuntimeConnectionTimeoutError,
      }
    }
  }

  /**
   * Create a user account: the unauthenticated first-user bootstrap with no session, otherwise an authenticated request
   * through the token authority.
   */
  async createUser(
    address: string,
    username: string,
    password: string,
    role?: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const body: { username: string; password: string; role?: string } = { username, password }
      if (role) body.role = role
      const payload = JSON.stringify(body)

      if (this.tokens.hasToken()) {
        const res = await this.makeRuntimeApiMutation('POST', address, '/api/create-user', payload)
        return res.success ? { success: true } : { success: false, error: res.error }
      }

      const res = await this.httpRequest({
        method: 'POST',
        url: this.runtimeUrl(address, '/api/create-user'),
        body: payload,
      })
      if (res.statusCode === 201) return { success: true }
      return { success: false, error: res.data }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  }

  /** Forget the session (logout / disconnect). */
  clearSession(): void {
    this.tokens.clear()
  }

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
    /** Refuse a response larger than this, in bytes. Omitted means unbounded. */
    maxResponseBytes?: number
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
        let received = 0
        let refused = false
        res.on('data', (chunk: Buffer) => {
          if (refused) return
          received += chunk.length
          if (options.maxResponseBytes !== undefined && received > options.maxResponseBytes) {
            refused = true
            req.destroy()
            reject(new Error(`The device sent more than this request allows (over ${options.maxResponseBytes} bytes).`))
            return
          }
          data += chunk.toString()
        })
        res.on('end', () => {
          if (refused) return
          resolve({ statusCode: res.statusCode ?? 0, data, headers: res.headers })
        })
      })
      const timeoutMs = options.timeoutMs ?? this.RUNTIME_CONNECTION_TIMEOUT_MS
      const onTimeout = () => {
        req.destroy()
        reject(new RuntimeConnectionTimeoutError())
      }
      const handshakeTimer = setTimeout(onTimeout, timeoutMs)
      req.on('socket', (socket) => {
        if (req.reusedSocket) {
          clearTimeout(handshakeTimer)
          return
        }
        socket.once('secureConnect', () => clearTimeout(handshakeTimer))
      })
      req.on('close', () => clearTimeout(handshakeTimer))
      req.setTimeout(timeoutMs, onTimeout)
      req.on('error', (error: Error) => {
        reject(error)
      })
      if (options.body) {
        req.write(options.body)
      }
      req.end()
    })
  }

  /** Full URL for a runtime endpoint. */
  private runtimeUrl(ipAddress: string, endpoint: string): string {
    return `https://${ipAddress}:${this.RUNTIME_API_PORT}${endpoint}`
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
        const parsed = LoginResponseSchema.safeParse(parseJsonOrNull(res.data))
        if (!parsed.success) return { success: false, error: 'Invalid response format' }
        return { success: true, accessToken: parsed.data.access_token }
      }
      return { success: false, error: res.data }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
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
    maxResponseBytes?: number,
  ): Promise<{ success: true; data?: T } | { success: false; error: string; statusCode?: number }> {
    type Raw = { success: true; data?: T } | { success: false; error: string; statusCode?: number }
    const url = this.runtimeUrl(ipAddress, endpoint)
    const result = await this.tokens.withAuth<Raw>(
      async (token) => {
        try {
          const res = await this.httpRequest({
            method: 'GET',
            url,
            headers: { Authorization: `Bearer ${token}` },
            maxResponseBytes,
          })
          if (res.statusCode === 200) return this.parseApiResponse(res.data, responseParser)
          return { success: false, error: res.data, statusCode: res.statusCode }
        } catch (error) {
          return { success: false, error: getErrorMessage(error) }
        }
      },
      (r) => !r.success && this.isTokenExpiredError(r.statusCode, r.error),
    )
    return result.success ? result : { success: false, error: result.error, statusCode: result.statusCode }
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
   * Authenticated PUT/DELETE through the token authority, retried only on 401. Any 2xx is success; returns the raw
   * body.
   */
  makeRuntimeApiMutation(
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

  /** Fetch the stored source project, base64 in JSON. A 403 is returned as an answer, not as a transport failure. */
  async retrieveProjectSnapshot(
    ipAddress: string,
  ): Promise<{ success: true; archive: Buffer; projectName: string } | { success: false; error: string }> {
    const result = await this.makeRuntimeApiRequest<ProjectSnapshotBody | null>(
      ipAddress,
      '/api/project-snapshot',
      (data) => ProjectSnapshotBodySchema.safeParse(parseJsonOrNull(data)).data ?? null,
      MAX_SNAPSHOT_RESPONSE_BYTES,
    )

    if (!result.success) {
      return { success: false, error: describeSnapshotFetchFailure(result.error, result.statusCode) }
    }
    if (!result.data) {
      return { success: false, error: 'The device sent an unreadable project archive' }
    }

    const archive = Buffer.from(result.data.contentBase64, 'base64')

    return { success: true, archive, projectName: result.data.projectName }
  }

  /**
   * Upload a compiled program (multipart) to the runtime through the token authority, which refreshes an expired token
   * and retries.
   */
  makeRuntimeApiUpload(opts: {
    ipAddress: string
    fileBuffer: Buffer
    filename: string
    contentType: string
    cleanBuild: boolean
    /** Optional source-project archive, sent as its own multipart part and stored on the device. */
    snapshotBuffer?: Buffer
    /** JSON metadata describing `snapshotBuffer`. */
    snapshotMetadata?: string
    onUploadAccepted?: (responseBody: string) => void
  }): Promise<{ success: true; data: string } | { success: false; error: string }> {
    type UploadResult = { success: true; data: string } | { success: false; error: string; statusCode?: number }
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2)
    const header = Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${headerSafe(opts.filename)}"\r\n` +
        `Content-Type: ${headerSafe(opts.contentType)}\r\n\r\n`,
    )

    const snapshotBuffer = opts.snapshotBuffer
    const snapshotMetadata = opts.snapshotMetadata
    const snapshotParts: Uint8Array[] =
      snapshotBuffer !== undefined && snapshotMetadata !== undefined
        ? [
            asBytes(
              Buffer.from(
                `\r\n--${boundary}\r\n` +
                  `Content-Disposition: form-data; name="snapshot"; filename="project.zip"\r\n` +
                  `Content-Type: application/zip\r\n\r\n`,
              ),
            ),
            asBytes(snapshotBuffer),
            asBytes(
              Buffer.from(
                `\r\n--${boundary}\r\n` +
                  `Content-Disposition: form-data; name="snapshot_metadata"\r\n` +
                  `Content-Type: application/json\r\n\r\n` +
                  snapshotMetadata,
              ),
            ),
          ]
        : []

    const footer = Buffer.from(`\r\n--${boundary}--\r\n`)
    const reqBody = Buffer.concat([asBytes(header), asBytes(opts.fileBuffer), ...snapshotParts, asBytes(footer)])
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
        (r) => !r.success && (r.statusCode === 401 || r.statusCode === 403),
      )
      .then((result) => {
        if (result.success) {
          const refusal = readUploadRefusal(result.data)
          if (refusal !== null) return { success: false as const, error: refusal }
          opts.onUploadAccepted?.(result.data)
          return { success: true as const, data: result.data }
        }
        return { success: false as const, error: result.error }
      })
  }

  /** One authenticated GET whose body carries a `status` string. */
  private async statusCommand(
    address: string,
    endpoint: string,
  ): Promise<{ success: boolean; status?: string; switchPosition?: string; error?: string }> {
    try {
      const result = await this.makeRuntimeApiRequest<z.infer<typeof PlcStatusResponseSchema>>(
        address,
        endpoint,
        (data: string) => PlcStatusResponseSchema.safeParse(parseJsonOrNull(data)).data ?? {},
      )
      if (!result.success) return { success: false, error: result.error }
      return {
        success: true,
        status: (result.data?.status ?? '').trim(),
        ...(result.data?.switchPosition ? { switchPosition: result.data.switchPosition } : {}),
      }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  }

  /**
   * Start the PLC and return the parsed `status`, which is `COMMAND:BUSY` while a previous program is still unloading.
   */
  startPlc(address: string): Promise<{ success: boolean; status?: string; error?: string }> {
    return this.statusCommand(address, '/api/start-plc')
  }

  /** Stop the PLC with a GET request. */
  stopPlc(address: string): Promise<{ success: boolean; status?: string; error?: string }> {
    return this.statusCommand(address, '/api/stop-plc')
  }

  /** Run state and mode-switch position. */
  getStatus(address: string): Promise<{ success: boolean; status?: string; switchPosition?: string; error?: string }> {
    return this.statusCommand(address, '/api/status')
  }

  /**
   * Run/stop over the REST control channel, in the Modbus path's result shape. `ERROR_SWITCH_STOP` maps to
   * `refusedBySwitch`.
   */
  async setPlcState(address: string, action: 'run' | 'stop'): Promise<PlcControlResult> {
    const result = action === 'run' ? await this.startPlc(address) : await this.stopPlc(address)
    if (!result.success) return { success: false, error: result.error }

    const status = result.status ?? ''
    if (status.includes('ERROR_SWITCH_STOP')) return { success: false, refusedBySwitch: true }

    return { success: true, state: action === 'run' ? PlcRuntimeState.RUNNING : PlcRuntimeState.STOPPED }
  }
}
