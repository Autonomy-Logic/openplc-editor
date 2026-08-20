/**
 * The editor's client for the OpenPLC Runtime v3/v4 REST API.
 *
 * Lifted verbatim out of `MainProcessBridge`, whose handlers now delegate here,
 * so the desktop GUI and the headless CLI make the SAME calls. It was not a
 * hypothetical concern: while the CLI briefly carried its own copy of this
 * layer it drifted within hours — it POSTed to `/api/start-plc` (the runtime
 * answers GET, and replies to a POST with `{"PostRequestError":"Unknown
 * argument"}`) and it read HTTP 200 as success, missing that the runtime
 * reports refusal in the BODY (`START:ERROR_SWITCH_STOP` when a physical mode
 * switch gates it, `COMMAND:BUSY` while a previous program is still
 * unloading). Both bugs are invisible until you have real hardware in front of
 * you, which is exactly the class of bug a second implementation produces.
 *
 * What it owns:
 *   - one `RuntimeTokenManager`, so every call (GET, POST, PUT/DELETE and the
 *     multipart program upload) self-heals identically when the 15-minute JWT
 *     expires;
 *   - the TLS posture (`getRuntimeHttpsOptions`), since real runtimes ship a
 *     self-signed certificate generated at install time;
 *   - the endpoint vocabulary and each route's success semantics.
 *
 * The address is per-call rather than per-instance because a single editor
 * session talks to whichever runtime the user points it at, while the token
 * authority needs one address to re-authenticate against — `setAddress` records
 * that at login.
 */

import type { IncomingHttpHeaders, IncomingMessage } from 'node:http'
import https from 'node:https'

import { getRuntimeHttpsOptions } from '@root/backend/editor/utils/runtime-https-config'
import type { PlcControlResult } from '@root/backend/shared/debug/types'
import { PlcRuntimeState } from '@root/backend/shared/simulator/types'
import { getErrorMessage } from '@root/frontend/utils/get-error-message'
import {
  createRuntimeTokenManager,
  type RuntimeTokenManager,
} from '@root/middleware/shared/runtime-auth/runtime-token-manager'

/** The runtime's HTTPS API port. Also the debug WebSocket's port. */
export const RUNTIME_API_PORT = 8443

export type RuntimeApiResult<T> = { success: true; data?: T } | { success: false; error: string }

export interface RuntimeApiClientOptions {
  /** Notified on every transparent token refresh (the GUI mirrors it to the renderer). */
  onTokenChanged?: (token: string) => void
}

export class RuntimeApiClient {
  private readonly RUNTIME_API_PORT = RUNTIME_API_PORT
  private readonly RUNTIME_CONNECTION_TIMEOUT_MS = 5000 // 5 seconds (important-comment)
  private readonly RUNTIME_LOGIN_TIMEOUT_MS = 15000 // 15 seconds

  /**
   * Address of the runtime this session is authenticated against. Captured at
   * login so the token authority can re-authenticate against the same device.
   */
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

  constructor(options: RuntimeApiClientOptions = {}) {
    if (options.onTokenChanged) this.tokens.onTokenChanged(options.onTokenChanged)
  }

  /** The address the token authority will re-authenticate against. */
  setAddress(ipAddress: string): void {
    this.runtimeIp = ipAddress
  }

  getAddress(): string | null {
    return this.runtimeIp
  }

  /**
   * Log in and adopt the session, so later calls can self-heal on expiry.
   * The one place that turns credentials into a live session.
   */
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

  /** Forget the session (logout / disconnect). */
  clearSession(): void {
    this.tokens.clear()
  }

  /**
   * Low-level HTTP helper that handles data accumulation, timeout, and error handling.
   * Returns the raw status code, response body, and headers for the caller to interpret.
   */
  httpRequest(options: {
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

  /** Full URL for a runtime endpoint. Public because handlers build their own requests. */
  runtimeUrl(ipAddress: string, endpoint: string): string {
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

  /** The `/api/start-plc` call, shared by the session router and the IPC handler. */
  async startPlc(address: string): Promise<{ success: boolean; status?: string; error?: string }> {
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

  /**
   * Stop the PLC. GET, like `startPlc` — see this module's docblock for why the
   * verb and the body-vs-status distinction both matter.
   */
  async stopPlc(address: string): Promise<{ success: boolean; status?: string; error?: string }> {
    try {
      const result = await this.makeRuntimeApiRequest<{ status?: string }>(
        address,
        '/api/stop-plc',
        (data: string) => JSON.parse(data) as { status?: string },
      )
      if (!result.success) return { success: false, error: result.error }
      return { success: true, status: (result.data?.status ?? '').trim() }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  }

  /** Run state and mode-switch position. */
  async getStatus(
    address: string,
  ): Promise<{ success: boolean; status?: string; switchPosition?: string; error?: string }> {
    try {
      const result = await this.makeRuntimeApiRequest<{ status?: string; switchPosition?: string }>(
        address,
        '/api/status',
        (data: string) => JSON.parse(data) as { status?: string; switchPosition?: string },
      )
      if (!result.success) return { success: false, error: result.error }
      return { success: true, status: result.data?.status, switchPosition: result.data?.switchPosition }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  }

  /**
   * Run/stop over the REST control channel, reported in the same shape the
   * Modbus path returns — so callers handle one result type, not two.
   *
   * `ERROR_SWITCH_STOP` in the runtime's reply is its way of saying the hardware
   * mode switch refused a start, which is exactly what `refusedBySwitch` means
   * on the Modbus side (FC 0x4b status 0x86). This is also why HTTP 200 cannot
   * be read as success on these routes.
   */
  async setPlcState(address: string, action: 'run' | 'stop'): Promise<PlcControlResult> {
    const result = action === 'run' ? await this.startPlc(address) : await this.stopPlc(address)
    if (!result.success) return { success: false, error: result.error }

    const status = result.status ?? ''
    if (status.includes('ERROR_SWITCH_STOP')) return { success: false, refusedBySwitch: true }

    // The runtime settles into the new state on its next scan; report the state
    // the command asked for so a caller can reflect it without a second round trip.
    return { success: true, state: action === 'run' ? PlcRuntimeState.RUNNING : PlcRuntimeState.STOPPED }
  }
}
