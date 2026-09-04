/**
 * Client for the runtime bootloader's control API (RTOP-283).
 *
 * The bootloader is a second, much smaller service on the same device: it
 * starts the runtime container, and when the runtime will not run it stays
 * reachable so a new version can be installed. It is what makes a version
 * change from the editor possible without SSH.
 *
 * A separate client from `RuntimeApiClient`, rather than a port parameter on
 * that one, for two reasons. It listens on its own port (8445), and it issues
 * its OWN sessions -- the two services share a credential database, not a
 * token, so a login here is a distinct login. Threading a port and a second
 * token authority through the runtime client would have made every existing
 * call site carry a concept it never needs.
 *
 * Responses are validated rather than asserted. These are HTTP bodies from a
 * device on the network, so `JSON.parse(...) as T` would claim a shape without
 * checking it and surface a missing field somewhere else entirely.
 */

import https from 'node:https'

import { getRuntimeHttpsOptions } from '@root/backend/editor/utils/runtime-https-config'
import { getErrorMessage } from '@root/frontend/utils/get-error-message'
import { z } from 'zod'

/** The bootloader's HTTPS control port. Odd, alongside the runtime's 8443. */
export const BOOTLOADER_API_PORT = 8445

/**
 * What the bootloader advertises without authentication, so the editor can
 * tell what it reached -- and whether the device is in recovery -- before it
 * has credentials.
 */
/**
 * Ceiling on a bootloader response body.
 *
 * Generous enough for the largest thing this API returns -- a log tail, which
 * the server caps -- and small enough that a device sending nonsense cannot
 * exhaust the editor's memory.
 */
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

/**
 * Host facts for the Runtime Status header.
 *
 * Served here rather than by the runtime because the bootloader is present on
 * every device this feature can act on, whatever runtime version it happens to
 * be running -- and because it reads these from the Docker daemon, which runs
 * on the host and answers for it, rather than from inside a container's own
 * namespace.
 *
 * Every field is optional: the daemon may be unreachable, in which case the
 * bootloader still reports the deployment facts it knows for itself.
 */
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

/**
 * Update progress. `percent` is absent while the daemon has reported no size
 * to work from -- for layers it already holds, and for the moment before any
 * size is known -- so a UI must treat "no percentage" as indeterminate rather
 * than as zero.
 */
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
/**
 * Types come from the port, not the other way round.
 *
 * The port used to import these from this file, which broke the layer rule
 * (`ports` may depend on `utils` and `ports` only) and turned the editor's
 * architecture job red. The port owns the contract; this client's schemas are
 * pinned to it below, so a drift between the two is a type error rather than
 * a silent divergence.
 */
import type {
  BootloaderApiResult,
  BootloaderCapabilities,
  BootloaderLogs,
  BootloaderStatus,
  BootloaderUpdateProgress,
  RuntimeDeviceInfo,
} from '@root/middleware/shared/ports/runtime-port'

/**
 * The schemas above must keep producing exactly the port's shapes. These
 * assignments are the check: if a schema and the contract drift apart, this
 * file stops compiling instead of the two quietly disagreeing.
 */
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
  BootloaderLogs,
  BootloaderStatus,
  BootloaderUpdateProgress,
  RuntimeDeviceInfo,
} from '@root/middleware/shared/ports/runtime-port'

const ErrorSchema = z.object({ error: z.string() })

/** A 409 carries the in-flight progress, so a second editor can follow along. */
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
  /**
   * Return a 409 body as a success instead of an error.
   *
   * Only the update route sets this: a conflict there means an update is
   * already running and the body carries its progress, which is what the
   * caller is trying to obtain.
   */
  treatConflictAsSuccess?: boolean
}

/**
 * Is this a bare host the editor is willing to dial?
 *
 * The address arrives from the renderer and is handed to https.request, so
 * anything that is not a plain hostname or IP literal is refused: an embedded
 * port, credentials, a path, a scheme, whitespace. Without this a compromised
 * renderer could shape the value into a request at a target of its choosing.
 *
 * This narrows the value; it does not authorize the destination. Restricting
 * requests to the device the operator actually selected needs main-process
 * device state, which does not exist today and would apply to every runtime
 * handler as much as to these -- a change worth making on its own rather
 * than half-making here.
 */
const BARE_HOST =
  /^(?:\[[0-9a-fA-F:]+\]|[0-9a-fA-F:]+|[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)$/

const isDialableHost = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 253 && BARE_HOST.test(value)

export class BootloaderApiClient {
  private readonly port = BOOTLOADER_API_PORT

  /** Short: the bootloader answers from memory and does no I/O to reply. */
  private readonly DEFAULT_TIMEOUT_MS = 8000

  /** Login runs PBKDF2 at 600k iterations, which on a Pi-class CPU is slow. */
  private readonly LOGIN_TIMEOUT_MS = 20000

  /**
   * The bootloader session, held per device address.
   *
   * Deliberately not shared with the runtime's token manager: the two services
   * issue their own tokens. Keyed by address so switching between devices does
   * not silently reuse another device's session.
   */
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
   * Is a bootloader answering on this device?
   *
   * Unauthenticated on purpose: the editor asks this to decide whether to
   * offer a version change at all, and it must be answerable before login.
   * A refusal or a timeout means "no bootloader here", which is the common
   * case for a native install or an orchestrator-managed vPLC -- not an error
   * worth showing anybody.
   */
  async getCapabilities(ipAddress: string): Promise<BootloaderApiResult<BootloaderCapabilities>> {
    const result = await this.request(ipAddress, {
      method: 'GET',
      path: '/api/bootloader/capabilities',
      // Shorter still: this runs on every connect, and a device with no
      // bootloader must not make the editor wait.
      timeoutMs: 4000,
    })
    if (!result.success) return result
    return this.parse(CapabilitiesSchema, result.data)
  }

  /**
   * Log in and remember the token for subsequent calls.
   *
   * The credentials are the runtime's own -- the two services read one user
   * database -- so the editor can reuse what the operator already entered.
   */
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

  /**
   * The runtime container's recent output.
   *
   * This is the point of the whole feature for a broken device: seeing WHY a
   * runtime will not start, from the editor, with no shell access.
   */
  async getRuntimeLogs(ipAddress: string, tail = 200): Promise<BootloaderApiResult<BootloaderLogs>> {
    const result = await this.authenticated(ipAddress, {
      method: 'GET',
      path: `/api/bootloader/logs?tail=${encodeURIComponent(String(tail))}`,
      // A log tail is the one response here that can be large.
      timeoutMs: 20000,
    })
    if (!result.success) return result
    return this.parse(LogsSchema, result.data)
  }

  /**
   * Ask for a version change. Returns as soon as the work is under way.
   *
   * Upgrade and downgrade are the same request: there is no separate
   * direction, and no version floor. The caller polls `getUpdateProgress`,
   * because a pull can run for many minutes on a slow device.
   */
  async startUpdate(ipAddress: string, version: string): Promise<BootloaderApiResult<BootloaderUpdateProgress>> {
    const result = await this.authenticated(ipAddress, {
      method: 'POST',
      path: '/api/bootloader/update',
      body: JSON.stringify({ version }),
      timeoutMs: 20000,
      // A 409 means an update is ALREADY running, and its body carries that
      // update's progress. Reported as a failure, the caller showed an error
      // and never started polling -- so a second editor, or one that opened
      // this dialog after the update began, could not follow along. The
      // conflict body is returned instead and the caller adopts it.
      treatConflictAsSuccess: true,
    })
    if (!result.success) return result

    // 202 carries { accepted, progress }; a 409 carries { error, progress }.
    // Both are read the same way -- the progress is the useful part.
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
      // Includes a health-gate on the way back up.
      timeoutMs: 120000,
    })
    if (!result.success) return result
    return this.parse(z.object({ state: z.string().optional(), reason: z.string().optional() }), result.data)
  }

  // --- plumbing ----------------------------------------------------------

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
    // A rejected token is worth forgetting, or every later call fails the same
    // way and the UI has no way to recover but a restart.
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
    // Every call, authenticated or not, passes through here -- the single
    // place the address can reach https.request.
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
          // The bootloader serves a self-signed certificate, as the runtime
          // does; the same opt-in env var governs both.
          ...getRuntimeHttpsOptions(),
        },
        (response) => {
          let data = ''
          let received = 0
          response.on('data', (chunk: Buffer | string) => {
            // Bounded. Without a cap, any bootloader endpoint -- a log tail
            // above all -- could grow this string until the editor process
            // runs out of memory, and a device is not a trusted source of
            // length just because it is on the LAN.
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
              // The body carries the in-flight progress, which is exactly
              // what the caller wanted.
              resolve({ success: true, data })
              return
            }
            resolve({ success: false, error: this.describeFailure(status, data) })
          })
        },
      )

      request.on('timeout', () => {
        request.destroy()
        resolve({
          success: false,
          error: `The bootloader on ${ipAddress}:${this.port} did not respond within ${timeout / 1000}s`,
        })
      })
      request.on('error', (error) => {
        resolve({ success: false, error: getErrorMessage(error) })
      })

      if (options.body !== undefined) request.write(options.body)
      request.end()
    })
  }

  /**
   * Turn a non-2xx into a message written for a person.
   *
   * The bootloader answers every failure as `{ "error": "..." }` and its
   * messages already say what to do, so they are surfaced verbatim rather than
   * replaced with a status code. A 409 keeps its progress payload so a caller
   * that wants it can re-parse.
   */
  private describeFailure(status: number, body: string): string {
    try {
      if (status === 409) {
        const conflict = ConflictSchema.parse(JSON.parse(body))
        return conflict.error
      }
      return ErrorSchema.parse(JSON.parse(body)).error
    } catch {
      // No structured body: say what happened without pretending to know why.
      if (status === 401) return 'The bootloader rejected these credentials'
      if (status === 0) return 'No response from the bootloader'
      return `The bootloader returned HTTP ${status}`
    }
  }
}
