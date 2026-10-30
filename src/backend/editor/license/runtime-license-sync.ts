/**
 * Runtime commercial licence delivery: the editor asks Edge for the licences
 * bought for a runtime's hardware ID and uploads each one to the runtime.
 *
 * `POST {edge}/runtime-licenses/lookup` is public and rate-limited; it takes
 * `{ hardwareId }` and answers `{ hardwareId, seats, licenses }` inside the
 * `{ statusCode, data }` envelope. The runtime verifies every file it is given
 * (signature and hardware ID) before storing it, so the editor only forwards.
 *
 * Best-effort throughout: nothing here throws, and a failure only means the
 * runtime keeps the licence state it already had.
 */

import type { RuntimeLicenseSyncResult, RuntimeLicenseUploadOutcome } from '@root/middleware/shared/ports'
import type { RuntimeHardwareIdResult } from '@root/middleware/shared/ports/runtime-port'
import { isRuntimeHardwareId } from '@root/middleware/shared/utils/licensing'

import { edgeRequest } from '../edge-account/edge-http'

export const RUNTIME_LICENSE_PRODUCT_ID = 'com.autonomy.openplc-runtime'

/** The runtime refuses larger bodies. */
export const MAX_RUNTIME_LICENSE_BYTES = 4096

const LOOKUP_PATH = '/runtime-licenses/lookup'
const ORDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** A licence file as Edge serves it, kept as the exact JSON text to forward. */
export interface RuntimeLicenseFile {
  orderId: string
  body: string
}

export type RuntimeLicenseLookupResult = { ok: true; licenses: RuntimeLicenseFile[] } | { ok: false; error: string }

export interface RuntimeLicenseSyncDeps {
  getHardwareId(): Promise<RuntimeHardwareIdResult>
  lookup(hardwareId: string): Promise<RuntimeLicenseLookupResult>
  upload(body: string): Promise<{ stored: boolean; error?: string }>
}

/**
 * The licence files in a lookup response that are for this product and this
 * hardware ID and fit the runtime's size cap. Anything else is dropped.
 */
export function selectRuntimeLicenseFiles(payload: unknown, hardwareId: string): RuntimeLicenseFile[] {
  const data = unwrapEnvelope(payload)
  if (typeof data !== 'object' || data === null) return []
  const { licenses } = data as { licenses?: unknown }
  if (!Array.isArray(licenses)) return []

  const files: RuntimeLicenseFile[] = []
  for (const entry of licenses) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
    const { product, hardware_id, order_id } = entry as { product?: unknown; hardware_id?: unknown; order_id?: unknown }
    if (product !== RUNTIME_LICENSE_PRODUCT_ID || hardware_id !== hardwareId) continue
    if (typeof order_id !== 'string' || !ORDER_ID_PATTERN.test(order_id)) continue
    const body = JSON.stringify(entry)
    if (Buffer.byteLength(body, 'utf-8') > MAX_RUNTIME_LICENSE_BYTES) continue
    files.push({ orderId: order_id, body })
  }
  return files
}

/** Ask Edge for the licences of `hardwareId`. Never throws. */
export async function lookupRuntimeLicenses(hardwareId: string): Promise<RuntimeLicenseLookupResult> {
  if (!isRuntimeHardwareId(hardwareId)) return { ok: false, error: 'Not a hardware ID.' }
  try {
    const res = await edgeRequest(LOOKUP_PATH, { method: 'POST', json: { hardwareId } })
    if (res.status < 200 || res.status >= 300) {
      return { ok: false, error: `The licence server refused the lookup (HTTP ${res.status}).` }
    }
    return { ok: true, licenses: selectRuntimeLicenseFiles(JSON.parse(res.body) as unknown, hardwareId) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Hardware ID, lookup, then one upload per licence file. Never throws. */
export async function syncRuntimeLicenses(deps: RuntimeLicenseSyncDeps): Promise<RuntimeLicenseSyncResult> {
  try {
    const id = await deps.getHardwareId()
    if (!id.success) return { status: 'failed', error: id.error }
    if (id.hardwareId === null) return { status: 'no-hardware-id' }

    const found = await deps.lookup(id.hardwareId)
    if (!found.ok) return { status: 'failed', error: found.error }

    const uploads: RuntimeLicenseUploadOutcome[] = []
    for (const file of found.licenses) {
      const result = await deps.upload(file.body)
      uploads.push({ orderId: file.orderId, stored: result.stored, ...(result.error ? { error: result.error } : {}) })
    }
    return { status: 'synced', hardwareId: id.hardwareId, uploads }
  } catch (err) {
    return { status: 'failed', error: err instanceof Error ? err.message : String(err) }
  }
}

function unwrapEnvelope(payload: unknown): unknown {
  if (typeof payload === 'object' && payload !== null && 'data' in payload && 'statusCode' in payload) {
    return (payload as { data: unknown }).data
  }
  return payload
}
