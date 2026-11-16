/**
 * Shared protocol helpers for the modular-coupler scan RPC.
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
export type ScanModulesRequestBody = {
  bus_name: string
  slave_position: number
  interface?: string
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
  const body: ScanModulesRequestBody = { bus_name: req.busName, slave_position: req.slavePosition }
  if (req.networkInterface !== undefined && req.networkInterface !== '') body.interface = req.networkInterface
  return body
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
  const hex = (match[1] ?? '').toLowerCase()
  if (hex.length > 8) return `0x${hex}`
  return `0x${hex.padStart(8, '0')}`
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

const text = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)

/**
 * Turn a parsed runtime body into the typed `ScanResponse`. Rejects anything missing the
 * `modules` array, and a reply numbering slots from 0: slots are 1-based end to end, and a
 * runtime that sends slot 0 predates that contract. `slavePosition` falls back to the request
 * value so a runtime that forgets to echo it still produces a usable response.
 */
export function parseScanModulesResponseBody(
  body: unknown,
  fallback: { slavePosition: number },
): Result<{ scan: ScanResponse }> {
  if (!isRecord(body)) {
    return { success: false, error: 'scan-modules response was empty' }
  }
  const list = body['modules']
  if (!Array.isArray(list)) {
    const explicit = text(body['error']) ?? text(body['message'])
    return { success: false, error: explicit ?? 'scan-modules response did not include a modules list' }
  }
  const modules: ScanResponse['modules'] = []
  for (const item of list) {
    if (!isRecord(item)) continue
    const slot = item['slot']
    const ident = item['ident']
    if (typeof slot !== 'number' || typeof ident !== 'string') continue
    if (!Number.isInteger(slot) || slot < 1) {
      return {
        success: false,
        error: `The runtime reported module slot ${slot}; slots start at 1. Update the runtime and scan again.`,
      }
    }
    // Ident 0 marks an empty slot: nothing to match or add.
    if (/^0x0+$/i.test(canonicaliseIdent(ident))) continue
    modules.push({ slot, ident: canonicaliseIdent(ident) })
  }
  const position = body['slave_position']
  return {
    success: true,
    scan: { slavePosition: typeof position === 'number' ? position : fallback.slavePosition, modules },
  }
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
    const body = isRecord(http.body) ? http.body : {}
    const reason =
      text(body['error']) ??
      text(body['message']) ??
      text(body['msg']) ??
      `scan-modules returned HTTP ${http.status_code}`
    return { success: false, error: reason }
  }
  return parseScanModulesResponseBody(http.body, fallback)
}
