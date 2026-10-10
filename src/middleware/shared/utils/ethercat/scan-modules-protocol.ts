/**
 * DOPE-704 E6 / RTOP-319 R3 — shared protocol helpers for the modular-coupler
 * scan RPC.
 *
 * Lives on the shared surface because the body shapes going between editor /
 * web and `openplc-runtime` → EtherDOG are identical regardless of transport.
 * Only the trip (IPC vs. orchestrator-proxied HTTPS) differs, and that part
 * stays in the per-platform adapter. Keeping the request/response contract
 * here means both adapters build the request and interpret the reply the same
 * way, so a shape change ships through a single file instead of drifting.
 */

import type { ScanRequest, ScanResponse } from '../../ports/ethercat-scan-port'
import type { Result } from '../../ports/types'

/** Shape POSTed to `/api/discovery/ethercat/scan-modules`. */
export interface ScanModulesRequestBody {
  bus_name: string
  slave_position: number
}

/** Shape returned by the runtime's `/api/discovery/ethercat/scan-modules`. */
export interface ScanModulesResponseBody {
  status?: string
  bus_name?: string
  slave_position?: number
  modules?: Array<{ slot?: number; ident?: string }>
  message?: string
  error?: string
}

/** Minimal envelope the editor/web adapters hand this helper after transport. */
export interface ScanModulesHttpResponse {
  status_code: number
  body?: unknown
}

export function buildScanModulesRequestBody(req: ScanRequest): ScanModulesRequestBody {
  return { bus_name: req.busName, slave_position: req.slavePosition }
}

/**
 * Canonicalise a module ident so comparisons against the ESI repository match
 * regardless of width or case. ETG.5001 encodes module idents as 32-bit
 * unsigned values; sources vary on how they print them — the ESI parser emits
 * `0x1A0F` from `#x1A0F`, while EtherDOG prints every slot as `0x00001A0F`
 * (zero-padded, upper-case). We normalise to lower-case 8-digit hex so a
 * repository entry and a scan reply name the same module with the same string.
 *
 * Only valid `0x`-prefixed hex passes through; anything else — including the
 * sentinel `0x0` an empty slot carries — is left untouched so callers can
 * detect "empty slot" without a special-case here.
 */
export function canonicaliseIdent(raw: string): string {
  const match = /^0x([0-9a-fA-F]+)$/.exec(raw)
  if (!match) return raw
  const hex = match[1].toLowerCase()
  if (hex.length > 8) return `0x${hex}`
  return `0x${hex.padStart(8, '0')}`
}

/**
 * Turn a parsed runtime body into the typed `ScanResponse`. Rejects anything
 * missing the `modules` array because the caller cannot usefully reconcile
 * against undefined. `slavePosition` falls back to the request value so a
 * runtime that forgets to echo it still produces a usable response.
 */
export function parseScanModulesResponseBody(
  body: unknown,
  fallback: { slavePosition: number },
): Result<{ scan: ScanResponse }> {
  if (!body || typeof body !== 'object') {
    return { success: false, error: 'scan-modules response was empty' }
  }
  const typed = body as ScanModulesResponseBody
  if (!Array.isArray(typed.modules)) {
    const explicit = typed.error ?? typed.message
    return { success: false, error: explicit ?? 'scan-modules response did not include a modules list' }
  }
  const modules = typed.modules
    .filter((m): m is { slot: number; ident: string } => typeof m?.slot === 'number' && typeof m?.ident === 'string')
    .map((m) => ({ slot: m.slot, ident: canonicaliseIdent(m.ident) }))
  const scan: ScanResponse = {
    slavePosition: typeof typed.slave_position === 'number' ? typed.slave_position : fallback.slavePosition,
    modules,
  }
  return { success: true, scan }
}

/**
 * Common HTTP-envelope → scan-response reducer. Handles the 200-vs-non-200
 * split and the error-field precedence (`error` → `message` → `msg`) so both
 * adapters share the same translation of runtime errors into user-facing text.
 */
export function parseScanModulesHttpResponse(
  http: ScanModulesHttpResponse,
  fallback: { slavePosition: number },
): Result<{ scan: ScanResponse }> {
  if (http.status_code !== 200) {
    const body = (http.body ?? {}) as { error?: string; message?: string; msg?: string }
    const reason = body.error ?? body.message ?? body.msg ?? `scan-modules returned HTTP ${http.status_code}`
    return { success: false, error: reason }
  }
  return parseScanModulesResponseBody(http.body, fallback)
}
