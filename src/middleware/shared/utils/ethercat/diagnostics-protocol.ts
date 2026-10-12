/**
 * Shared request/response protocol for the modular-coupler diagnostics RPC.  Mirrors the
 * scan-modules protocol: both editor and web build the request body here and parse the
 * runtime's reply here, so a shape change ships through one file.
 */

import type { DiagnosticsRequest, DiagnosticsSnapshot } from '../../ports/ethercat-diagnostics-port'
import type { Result } from '../../ports/types'

export interface DiagnosticsRequestBody {
  bus_name: string
  slave_position: number
}

export interface DiagnosticsResponseBody {
  status?: string
  bus_name?: string
  slave_position?: number
  coupler?: { status_word?: number; poll_at_ms?: number }
  modules?: Array<{ slot?: number; status_byte?: number }>
  error?: string
  message?: string
}

export interface DiagnosticsHttpResponse {
  status_code: number
  body?: unknown
}

export function buildDiagnosticsRequestBody(req: DiagnosticsRequest): DiagnosticsRequestBody {
  return { bus_name: req.busName, slave_position: req.slavePosition }
}

export function parseDiagnosticsResponseBody(
  body: unknown,
  fallback: { slavePosition: number },
): Result<{ snapshot: DiagnosticsSnapshot }> {
  if (!body || typeof body !== 'object') {
    return { success: false, error: 'diagnostics response was empty' }
  }
  const typed = body as DiagnosticsResponseBody
  if (typed.coupler === undefined || typeof typed.coupler.status_word !== 'number') {
    const explicit = typed.error ?? typed.message
    return { success: false, error: explicit ?? 'diagnostics response did not include coupler.status_word' }
  }
  const modulesRaw = Array.isArray(typed.modules) ? typed.modules : []
  const modules = modulesRaw
    .filter((m): m is { slot: number; status_byte: number } =>
      typeof m?.slot === 'number' && typeof m?.status_byte === 'number',
    )
    .map((m) => ({ slot: m.slot, statusByte: m.status_byte }))
    .sort((a, b) => a.slot - b.slot)
  const pollAt = typeof typed.coupler.poll_at_ms === 'number' ? typed.coupler.poll_at_ms : Date.now()
  const snapshot: DiagnosticsSnapshot = {
    coupler: { statusWord: typed.coupler.status_word, pollAt },
    modules,
  }
  // slavePosition fallback kept so adapters can report the response consistently.
  void fallback
  return { success: true, snapshot }
}

export function parseDiagnosticsHttpResponse(
  http: DiagnosticsHttpResponse,
  fallback: { slavePosition: number },
): Result<{ snapshot: DiagnosticsSnapshot }> {
  if (http.status_code !== 200) {
    const body = (http.body ?? {}) as { error?: string; message?: string; msg?: string }
    const reason = body.error ?? body.message ?? body.msg ?? `diagnostics returned HTTP ${http.status_code}`
    return { success: false, error: reason }
  }
  return parseDiagnosticsResponseBody(http.body, fallback)
}
