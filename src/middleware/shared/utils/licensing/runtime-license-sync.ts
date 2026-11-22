/**
 * Runtime commercial licence check for OpenPLC Runtime v4, shared by every
 * platform. One runtime ID holds one licence. On connect the stored licence is
 * verified offline, then confirmed against Edge's active licences for that ID
 * (short timeout, fail-open): a stored licence Edge no longer lists is removed
 * from the runtime, and a missing or invalid one is replaced by a valid one Edge
 * holds. The runtime checks no signature; the status comes from this
 * verification. Platforms supply only `RuntimeLicenseMechanisms`.
 *
 * `GET /api/runtime-license` is public and answers `{ hardwareId, licenses }`
 * (0 or 1 entries); runtimes without it answer 401. `GET /api/hardware-id`
 * answers `{ hardwareId, elements }`. `POST {edge}/runtime-licenses/lookup` is
 * public and rate-limited; it takes `{ hardwareId }` and answers the active
 * licences inside the `{ statusCode, data }` envelope.
 *
 * Best-effort throughout: nothing here throws.
 */

import type { PublicRuntimeLicenseStatus } from '../../ports/orchestrator-port'
import type { RawHttpReply, RuntimeLicenseMechanisms } from '../../ports/runtime-license-mechanisms'
import type {
  RuntimeHardwareIdResult,
  RuntimeLicenseRevocation,
  RuntimeLicenseSyncResult,
  RuntimeLicenseUploadOutcome,
} from '../../ports/runtime-port'
import {
  isRuntimeHardwareId,
  parseRuntimeHardwareElements,
  parseRuntimeHardwareId,
  type RuntimeHardwareElement,
  type RuntimeHardwareIdSource,
} from './runtime-commercial-license'
import { type RuntimeLicenseFileVerdict, verifyRuntimeLicenseFile } from './runtime-license-file'
import { RUNTIME_LICENSE_PRODUCT_ID, type RuntimeLicenseKeys } from './runtime-license-keys'

/** The runtime refuses larger bodies. */
export const MAX_RUNTIME_LICENSE_BYTES = 4096

export const RUNTIME_LICENSE_LOOKUP_PATH = '/runtime-licenses/lookup'
export const RUNTIME_HARDWARE_ID_PATH = '/api/hardware-id'
export const RUNTIME_LICENSE_UPLOAD_PATH = '/api/runtime-license'
export const RUNTIME_LICENSE_REPORT_PATH = '/api/runtime-license'
export const RUNTIME_LICENSE_REMOVE_PATH = '/api/runtime-license'

/** How long the Edge lookup may take before the offline verdict stands. */
export const RUNTIME_LICENSE_LOOKUP_TIMEOUT_MS = 2000

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

/** The runtime's hardware ID and element hashes from `GET /api/hardware-id`. Never throws. */
export async function readRuntimeHardwareId(mechanisms: RuntimeLicenseMechanisms): Promise<RuntimeHardwareIdResult> {
  try {
    const reply = await mechanisms.runtimeGet(RUNTIME_HARDWARE_ID_PATH)
    if (!isSuccess(reply)) return { success: false, error: `Get hardware ID failed: ${reply.status}` }
    const body = bodyJson(reply)
    const parsed = parseRuntimeHardwareId(body)
    return parsed
      ? { success: true, ...parsed, elements: parseRuntimeHardwareElements(body) }
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
    const body = bodyJson(reply)
    if (!hasLicenseList(body))
      return { ok: false, error: 'The licence server sent a lookup answer the editor could not read.' }
    return { ok: true, licenses: selectRuntimeLicenseFiles(body, hardwareId) }
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
  /** Reported by older runtimes only; not used for any decision. */
  source: RuntimeHardwareIdSource | null
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
    return { ok: true, report: { hardwareId: id.hardwareId, source: id.source, licenses } }
  } catch (err) {
    return { ok: false, error: errorMessage(err) }
  }
}

/** Order ID of the first reported licence that verifies for the reported hardware ID, or null. */
export async function validReportedOrderId(
  report: RuntimeLicenseReport,
  keys: RuntimeLicenseKeys,
): Promise<string | null> {
  if (report.hardwareId === null) return null
  for (const license of report.licenses) {
    const verdict = await verifyRuntimeLicenseFile(license, report.hardwareId, keys)
    if (verdict.ok) return verdict.orderId
  }
  return null
}

/** True when any reported licence verifies for the reported hardware ID. */
export async function reportHasValidLicense(report: RuntimeLicenseReport, keys: RuntimeLicenseKeys): Promise<boolean> {
  return (await validReportedOrderId(report, keys)) !== null
}

/** Remove the stored licence with `DELETE /api/runtime-license`. Never throws. */
export async function removeRuntimeLicense(
  mechanisms: RuntimeLicenseMechanisms,
  orderId: string,
): Promise<RuntimeLicenseRevocation> {
  try {
    const reply = await mechanisms.runtimeDelete(RUNTIME_LICENSE_REMOVE_PATH)
    if (isSuccess(reply)) return { orderId, removed: true }
    return { orderId, removed: false, error: replyError(reply) }
  } catch (err) {
    return { orderId, removed: false, error: errorMessage(err) }
  }
}

/**
 * Licence status from a public `GET /api/runtime-license` reply, verified here: 401 is a runtime
 * without the endpoint (`mit`), a verified licence `commercial`, none `gpl`, anything else `unknown`.
 */
export async function classifyPublicRuntimeLicense(
  reply: RawHttpReply,
  keys: RuntimeLicenseKeys,
): Promise<PublicRuntimeLicenseStatus> {
  if (reply.status === 401) return 'mit'
  if (!isSuccess(reply)) return 'unknown'
  const body = bodyJson(reply)
  const id = parseRuntimeHardwareId(body)
  const { licenses } = (body ?? {}) as { licenses?: unknown }
  if (!id || id.hardwareId === null || !Array.isArray(licenses)) return 'unknown'
  const orderId = await validReportedOrderId({ hardwareId: id.hardwareId, source: id.source, licenses }, keys)
  return orderId ? 'commercial' : 'gpl'
}

const VERDICT_REASONS: Record<Exclude<RuntimeLicenseFileVerdict, { ok: true }>['reason'], string> = {
  'not-a-license': 'not a runtime license file',
  'other-product': 'it was issued for another product',
  'other-device': 'it was issued for another hardware ID',
  signature: 'its signature is not accepted',
}

/** The element hashes of `hardwareId`, or none when the runtime cannot say. */
async function readElementsFor(
  mechanisms: RuntimeLicenseMechanisms,
  hardwareId: string,
): Promise<RuntimeHardwareElement[]> {
  const id = await readRuntimeHardwareId(mechanisms)
  return id.success && id.hardwareId === hardwareId ? id.elements : []
}

/** The lookup, or a failure once `ms` has passed. */
function lookupWithTimeout(
  mechanisms: RuntimeLicenseMechanisms,
  hardwareId: string,
  ms: number,
): Promise<RuntimeLicenseLookupResult> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, error: 'The licence server did not answer in time.' }), ms)
    void lookupRuntimeLicenses(mechanisms, hardwareId).then((result) => {
      clearTimeout(timer)
      resolve(result)
    })
  })
}

/**
 * Verify the stored licence offline, then confirm it against Edge's active licences for the
 * runtime's ID. Edge reachable and the stored order not active: remove it from the runtime.
 * Stored licence missing, invalid or removed: upload the first valid Edge licence and read the
 * runtime back. Edge unreachable: the offline verdict stands. Never throws.
 */
export async function syncRuntimeLicenses(
  mechanisms: RuntimeLicenseMechanisms,
  keys: RuntimeLicenseKeys,
  lookupTimeoutMs: number = RUNTIME_LICENSE_LOOKUP_TIMEOUT_MS,
): Promise<RuntimeLicenseSyncResult> {
  const first = await readRuntimeLicenseReport(mechanisms)
  if (!first.ok) return { status: 'failed', error: first.error }
  const { hardwareId } = first.report
  if (hardwareId === null) return { status: 'no-hardware-id' }
  const elements = await readElementsFor(mechanisms, hardwareId)
  const storedOrderId = await validReportedOrderId(first.report, keys)

  const found = await lookupWithTimeout(mechanisms, hardwareId, lookupTimeoutMs)
  if (!found.ok) {
    return storedOrderId
      ? { status: 'synced', hardwareId, license: 'commercial', uploads: [], elements }
      : { status: 'synced', hardwareId, license: 'gpl', uploads: [], elements, detail: found.error }
  }
  if (storedOrderId && found.licenses.some((file) => file.orderId === storedOrderId)) {
    return { status: 'synced', hardwareId, license: 'commercial', uploads: [], elements }
  }

  const revoked = storedOrderId ? await removeRuntimeLicense(mechanisms, storedOrderId) : undefined
  const withRevocation = revoked ? { revoked } : {}

  const uploads: RuntimeLicenseUploadOutcome[] = []
  for (const file of found.licenses) {
    const verdict = await verifyRuntimeLicenseFile(file.license, hardwareId, keys)
    const outcome: RuntimeLicenseUploadOutcome = verdict.ok
      ? await uploadRuntimeLicense(mechanisms, file)
      : { orderId: file.orderId, stored: false, error: VERDICT_REASONS[verdict.reason] }
    uploads.push(outcome)
    if (outcome.stored) break
  }
  if (!uploads.some((upload) => upload.stored)) {
    return { status: 'synced', hardwareId, license: 'gpl', uploads, elements, ...withRevocation }
  }

  const again = await readRuntimeLicenseReport(mechanisms)
  if (!again.ok) {
    return { status: 'failed', error: `License uploaded, but the runtime could not be read back: ${again.error}` }
  }
  if (again.report.hardwareId !== hardwareId) {
    return {
      status: 'synced',
      hardwareId,
      license: 'gpl',
      uploads,
      elements,
      ...withRevocation,
      detail: 'The runtime reported another hardware ID after the upload.',
    }
  }
  const license = (await reportHasValidLicense(again.report, keys)) ? 'commercial' : 'gpl'
  return { status: 'synced', hardwareId, license, uploads, elements, ...withRevocation }
}

/**
 * Runs `run` once per key at a time: a call made while the run for its key is in flight shares that
 * run's promise, and the first call after it settles starts a new one.
 */
export function createInFlightByKey<T>(): (key: string, run: () => Promise<T>) => Promise<T> {
  const inFlight = new Map<string, Promise<T>>()
  return (key, run) => {
    const pending = inFlight.get(key)
    if (pending) return pending
    const started = run().finally(() => inFlight.delete(key))
    inFlight.set(key, started)
    return started
  }
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

/** True when the (possibly enveloped) lookup body carries a `licenses` array. */
function hasLicenseList(payload: unknown): boolean {
  const data = unwrapEnvelope(payload)
  return typeof data === 'object' && data !== null && Array.isArray((data as { licenses?: unknown }).licenses)
}

function unwrapEnvelope(payload: unknown): unknown {
  if (typeof payload === 'object' && payload !== null && 'data' in payload && 'statusCode' in payload) {
    return (payload as { data: unknown }).data
  }
  return payload
}
