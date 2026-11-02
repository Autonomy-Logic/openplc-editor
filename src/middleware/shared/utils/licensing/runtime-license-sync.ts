/**
 * Runtime commercial licence delivery, shared by every platform: read the
 * runtime's hardware ID, ask Edge for the licences bought for it and upload
 * each one to the runtime. Platforms supply only `RuntimeLicenseMechanisms`.
 *
 * `POST {edge}/runtime-licenses/lookup` is public and rate-limited; it takes
 * `{ hardwareId }` and answers `{ hardwareId, seats, licenses }` inside the
 * `{ statusCode, data }` envelope. The runtime verifies every file it is given
 * (signature and hardware ID) before storing it, so the editor only forwards.
 *
 * Best-effort throughout: nothing here throws, and a failure only means the
 * runtime keeps the licence state it already had.
 */

import type { RawHttpReply, RuntimeLicenseMechanisms } from '../../ports/runtime-license-mechanisms'
import type {
  RuntimeHardwareIdResult,
  RuntimeLicenseSyncResult,
  RuntimeLicenseUploadOutcome,
} from '../../ports/runtime-port'
import { isRuntimeHardwareId, parseRuntimeHardwareId } from './runtime-commercial-license'

export const RUNTIME_LICENSE_PRODUCT_ID = 'com.autonomy.openplc-runtime'

/** The runtime refuses larger bodies. */
export const MAX_RUNTIME_LICENSE_BYTES = 4096

export const RUNTIME_LICENSE_LOOKUP_PATH = '/runtime-licenses/lookup'
export const RUNTIME_HARDWARE_ID_PATH = '/api/hardware-id'
export const RUNTIME_LICENSE_UPLOAD_PATH = '/api/runtime-license'

const ORDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** A licence file as Edge serves it, forwarded unchanged. */
export interface RuntimeLicenseFile {
  orderId: string
  license: Record<string, unknown>
}

export type RuntimeLicenseLookupResult = { ok: true; licenses: RuntimeLicenseFile[] } | { ok: false; error: string }

/**
 * The licence files in a lookup response that are for this product and this
 * hardware ID and fit the runtime's size cap. Anything else is dropped.
 */
export function selectRuntimeLicenseFiles(payload: unknown, hardwareId: string): RuntimeLicenseFile[] {
  const data = unwrapEnvelope(payload)
  if (typeof data !== 'object' || data === null) return []
  const { licenses } = data as { licenses?: unknown }
  if (!Array.isArray(licenses)) return []

  const encoder = new TextEncoder()
  const files: RuntimeLicenseFile[] = []
  for (const entry of licenses) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
    const license = entry as Record<string, unknown>
    const { product, hardware_id, order_id } = license
    if (product !== RUNTIME_LICENSE_PRODUCT_ID || hardware_id !== hardwareId) continue
    if (typeof order_id !== 'string' || !ORDER_ID_PATTERN.test(order_id)) continue
    if (encoder.encode(JSON.stringify(license)).byteLength > MAX_RUNTIME_LICENSE_BYTES) continue
    files.push({ orderId: order_id, license })
  }
  return files
}

/** The runtime's hardware ID from `GET /api/hardware-id`. Never throws. */
export async function readRuntimeHardwareId(mechanisms: RuntimeLicenseMechanisms): Promise<RuntimeHardwareIdResult> {
  try {
    const reply = await mechanisms.runtimeGet(RUNTIME_HARDWARE_ID_PATH)
    if (!isSuccess(reply)) return { success: false, error: `Get hardware ID failed: ${reply.status}` }
    const parsed = parseRuntimeHardwareId(bodyJson(reply))
    return parsed
      ? { success: true, ...parsed }
      : { success: false, error: 'The runtime sent a hardware ID the editor could not read.' }
  } catch (err) {
    return { success: false, error: errorMessage(err) }
  }
}

/** Ask Edge for the licences of `hardwareId`. Never throws. */
export async function lookupRuntimeLicenses(
  mechanisms: RuntimeLicenseMechanisms,
  hardwareId: string,
): Promise<RuntimeLicenseLookupResult> {
  if (!isRuntimeHardwareId(hardwareId)) return { ok: false, error: 'Not a hardware ID.' }
  try {
    const reply = await mechanisms.edgePost(RUNTIME_LICENSE_LOOKUP_PATH, { hardwareId })
    if (!isSuccess(reply)) {
      return { ok: false, error: `The licence server refused the lookup (HTTP ${reply.status}).` }
    }
    return { ok: true, licenses: selectRuntimeLicenseFiles(bodyJson(reply), hardwareId) }
  } catch (err) {
    return { ok: false, error: errorMessage(err) }
  }
}

/** Upload one licence file to the runtime. Never throws. */
export async function uploadRuntimeLicense(
  mechanisms: RuntimeLicenseMechanisms,
  file: RuntimeLicenseFile,
): Promise<RuntimeLicenseUploadOutcome> {
  try {
    const reply = await mechanisms.runtimePost(RUNTIME_LICENSE_UPLOAD_PATH, file.license)
    if (isSuccess(reply)) return { orderId: file.orderId, stored: true }
    return { orderId: file.orderId, stored: false, error: replyError(reply) }
  } catch (err) {
    return { orderId: file.orderId, stored: false, error: errorMessage(err) }
  }
}

/** Hardware ID, lookup, then one upload per licence file. Never throws. */
export async function syncRuntimeLicenses(mechanisms: RuntimeLicenseMechanisms): Promise<RuntimeLicenseSyncResult> {
  const id = await readRuntimeHardwareId(mechanisms)
  if (!id.success) return { status: 'failed', error: id.error }
  if (id.hardwareId === null) return { status: 'no-hardware-id' }

  const found = await lookupRuntimeLicenses(mechanisms, id.hardwareId)
  if (!found.ok) return { status: 'failed', error: found.error }

  const uploads: RuntimeLicenseUploadOutcome[] = []
  for (const file of found.licenses) uploads.push(await uploadRuntimeLicense(mechanisms, file))
  return { status: 'synced', hardwareId: id.hardwareId, uploads }
}

function isSuccess(reply: RawHttpReply): boolean {
  return reply.status >= 200 && reply.status < 300
}

/** The reply body as JSON; text that does not parse becomes null. */
function bodyJson(reply: RawHttpReply): unknown {
  if (typeof reply.body !== 'string') return reply.body
  try {
    return JSON.parse(reply.body) as unknown
  } catch {
    return null
  }
}

function replyError(reply: RawHttpReply): string {
  const body = bodyJson(reply)
  if (typeof body === 'object' && body !== null) {
    const { error, msg } = body as { error?: unknown; msg?: unknown }
    if (typeof error === 'string' && error) return error
    if (typeof msg === 'string' && msg) return msg
  }
  if (typeof reply.body === 'string' && reply.body) return reply.body
  return `HTTP ${reply.status}`
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function unwrapEnvelope(payload: unknown): unknown {
  if (typeof payload === 'object' && payload !== null && 'data' in payload && 'statusCode' in payload) {
    return (payload as { data: unknown }).data
  }
  return payload
}
