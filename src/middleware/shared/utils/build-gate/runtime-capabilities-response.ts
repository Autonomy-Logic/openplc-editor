import type { RuntimeCapabilitiesResult } from '@root/middleware/shared/ports/runtime-port'

/** One answer from the runtime's `GET /api/discovery/ethercat/capabilities`. */
export interface CapabilitiesResponse {
  /** HTTP status, or `undefined` when the request never got an answer. */
  statusCode: number | undefined
  /** Parsed JSON body of a 200 answer. */
  body?: unknown
  /** Transport error or the body text of a failed answer. */
  error?: string
}

const field = (raw: unknown, key: string): unknown =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw) && key in raw ? Reflect.get(raw, key) : undefined

/**
 * Reads a capabilities answer. A 404 comes from a runtime that predates the endpoint, which
 * advertises no features. Any other failure, and `available: false` (EtherDOG not running),
 * leaves the features unknown (`null`) with the reason in `error`.
 */
export function capabilitiesFromResponse(response: CapabilitiesResponse): RuntimeCapabilitiesResult {
  const { statusCode, body, error } = response
  if (statusCode === 404) return { features: [] }
  if (statusCode !== 200) {
    const reason = error !== undefined && error.trim() !== '' ? error : undefined
    return {
      features: null,
      error: reason ?? (statusCode === undefined ? 'no answer from the runtime' : `HTTP ${statusCode}`),
    }
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { features: null, error: 'the capabilities answer is not an object' }
  }
  const version = field(body, 'version')
  const runtimeVersion = typeof version === 'string' ? version : undefined
  if (field(body, 'available') === false) {
    const message = field(body, 'message')
    return {
      features: null,
      runtimeVersion,
      error: `EtherDOG is not running on the target${typeof message === 'string' && message !== '' ? ` (${message})` : ''}`,
    }
  }
  const list = field(body, 'features')
  const features = Array.isArray(list) ? list.filter((f): f is string => typeof f === 'string') : []
  return { features, runtimeVersion }
}
