/**
 * Shared request/response protocol for the modular-coupler diagnostics RPC.  Mirrors the
 * scan-modules protocol: both editor and web build the request body here and parse the
 * runtime's reply here, so a shape change ships through one file.
 */

import type { DiagnosticsRequest, DiagnosticsSnapshot } from '../../ports/ethercat-diagnostics-port'
import type { Result } from '../../ports/types'

export type DiagnosticsRequestBody = {
  bus_name: string
  slave_position: number
}

export interface DiagnosticsResponseBody {
  status?: string
  bus_name?: string
  slave_position?: number
  coupler?: { status_word?: number | null; poll_at_ms?: number }
  modules?: Array<{ slot?: number; status_byte?: number | null }>
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

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const text = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)

export function parseDiagnosticsResponseBody(
  body: unknown,
  fallback: { slavePosition: number },
): Result<{ snapshot: DiagnosticsSnapshot }> {
  if (!isRecord(body)) {
    return { success: false, error: 'diagnostics response was empty' }
  }
  const coupler = body['coupler']
  const statusWord = isRecord(coupler) ? coupler['status_word'] : undefined
  if (!isRecord(coupler) || (typeof statusWord !== 'number' && statusWord !== null)) {
    const explicit = text(body['error']) ?? text(body['message'])
    return { success: false, error: explicit ?? 'diagnostics response did not include coupler.status_word' }
  }
  const list = body['modules']
  const modules: DiagnosticsSnapshot['modules'] = []
  for (const m of Array.isArray(list) ? list : []) {
    if (!isRecord(m)) continue
    const slot = m['slot']
    const statusByte = m['status_byte']
    if (typeof slot === 'number' && (typeof statusByte === 'number' || statusByte === null)) {
      modules.push({ slot, statusByte })
    }
  }
  modules.sort((a, b) => a.slot - b.slot)
  const pollAtMs = coupler['poll_at_ms']
  const snapshot: DiagnosticsSnapshot = {
    coupler: { statusWord, pollAt: typeof pollAtMs === 'number' ? pollAtMs : Date.now() },
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
    const body = isRecord(http.body) ? http.body : {}
    const reason =
      text(body['error']) ??
      text(body['message']) ??
      text(body['msg']) ??
      `diagnostics returned HTTP ${http.status_code}`
    return { success: false, error: reason }
  }
  return parseDiagnosticsResponseBody(http.body, fallback)
}
