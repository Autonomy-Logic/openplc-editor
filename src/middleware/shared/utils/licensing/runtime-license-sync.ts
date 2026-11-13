/**
 * Runtime commercial licence check for OpenPLC Runtime v4, shared by every
 * platform: read the licences the runtime holds with its hardware ID, verify
 * them here, and when none is valid ask Edge for the licences bought for that
 * hardware ID, verify each one and upload the valid ones. The runtime checks no
 * signature; the status comes from this verification. Platforms supply only
 * `RuntimeLicenseMechanisms`.
 *
 * `GET /api/runtime-license` answers `{ hardwareId, source, licenses }`; in a
 * vPLC `licenses` holds only the seat licence orchestrator-agent assigned.
 * `POST {edge}/runtime-licenses/lookup` is public and rate-limited; it takes
 * `{ hardwareId }` and answers `{ hardwareId, seats, licenses }` inside the
 * `{ statusCode, data }` envelope.
 *
 * Best-effort throughout: nothing here throws.
 */

import type { RawHttpReply, RuntimeLicenseMechanisms } from '../../ports/runtime-license-mechanisms'
import type {
  RuntimeHardwareIdResult,
  RuntimeLicenseSyncResult,
  RuntimeLicenseUploadOutcome,
} from '../../ports/runtime-port'
import { isRuntimeHardwareId, parseRuntimeHardwareId } from './runtime-commercial-license'
import { type RuntimeLicenseFileVerdict, verifyRuntimeLicenseFile } from './runtime-license-file'
import { RUNTIME_LICENSE_PRODUCT_ID, type RuntimeLicenseKeys } from './runtime-license-keys'

/** The runtime refuses larger bodies. */
export const MAX_RUNTIME_LICENSE_BYTES = 4096

export const RUNTIME_LICENSE_LOOKUP_PATH = '/runtime-licenses/lookup'
export const RUNTIME_HARDWARE_ID_PATH = '/api/hardware-id'
export const RUNTIME_LICENSE_UPLOAD_PATH = '/api/runtime-license'
export const RUNTIME_LICENSE_REPORT_PATH = '/api/runtime-license'

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

/** What `GET /api/runtime-license` reported: the hardware ID and the licences, unverified. */
export interface RuntimeLicenseReport {
  hardwareId: string | null
  licenses: unknown[]
}

export type RuntimeLicenseReportResult = { ok: true; report: RuntimeLicenseReport } | { ok: false; error: string }

/** The runtime's hardware ID and stored licences. Never throws. */
export async function readRuntimeLicenseReport(
  mechanisms: RuntimeLicenseMechanisms,
): Promise<RuntimeLicenseReportResult> {
  try {
    const reply = await mechanisms.runtimeGet(RUNTIME_LICENSE_REPORT_PATH)
    if (!isSuccess(reply)) return { ok: false, error: `Get runtime licenses failed: ${reply.status}` }
    const body = bodyJson(reply)
    const id = parseRuntimeHardwareId(body)
    const { licenses } = (body ?? {}) as { licenses?: unknown }
    if (!id || !Array.isArray(licenses)) {
      return { ok: false, error: 'The runtime sent a license report the editor could not read.' }
    }
    return { ok: true, report: { hardwareId: id.hardwareId, licenses } }
  } catch (err) {
    return { ok: false, error: errorMessage(err) }
  }
}

/** True when any reported licence verifies for the reported hardware ID. */
export async function reportHasValidLicense(report: RuntimeLicenseReport, keys: RuntimeLicenseKeys): Promise<boolean> {
  if (report.hardwareId === null) return false
  for (const license of report.licenses) {
    if ((await verifyRuntimeLicenseFile(license, report.hardwareId, keys)).ok) return true
  }
  return false
}

const VERDICT_REASONS: Record<Exclude<RuntimeLicenseFileVerdict, { ok: true }>['reason'], string> = {
  'not-a-license': 'not a runtime license file',
  'other-product': 'it was issued for another product',
  'other-device': 'it was issued for another hardware ID',
  signature: 'its signature is not accepted',
}

/**
 * Read the runtime's licences and verify them; when none is valid, look up Edge, verify each
 * file and upload only the valid ones, then read the runtime again. Never throws.
 */
export async function syncRuntimeLicenses(
  mechanisms: RuntimeLicenseMechanisms,
  keys: RuntimeLicenseKeys,
): Promise<RuntimeLicenseSyncResult> {
  const first = await readRuntimeLicenseReport(mechanisms)
  if (!first.ok) return { status: 'failed', error: first.error }
  const { hardwareId } = first.report
  if (hardwareId === null) return { status: 'no-hardware-id' }
  if (await reportHasValidLicense(first.report, keys)) {
    return { status: 'synced', hardwareId, license: 'commercial', uploads: [] }
  }

  const found = await lookupRuntimeLicenses(mechanisms, hardwareId)
  if (!found.ok) return { status: 'synced', hardwareId, license: 'gpl', uploads: [], detail: found.error }

  const uploads: RuntimeLicenseUploadOutcome[] = []
  for (const file of found.licenses) {
    const verdict = await verifyRuntimeLicenseFile(file.license, hardwareId, keys)
    uploads.push(
      verdict.ok
        ? await uploadRuntimeLicense(mechanisms, file)
        : { orderId: file.orderId, stored: false, error: VERDICT_REASONS[verdict.reason] },
    )
  }
  if (!uploads.some((upload) => upload.stored)) return { status: 'synced', hardwareId, license: 'gpl', uploads }

  const second = await readRuntimeLicenseReport(mechanisms)
  if (!second.ok) return { status: 'synced', hardwareId, license: 'gpl', uploads, detail: second.error }
  const license = (await reportHasValidLicense(second.report, keys)) ? 'commercial' : 'gpl'
  return { status: 'synced', hardwareId, license, uploads }
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
