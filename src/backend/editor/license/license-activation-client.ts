/**
 * Device license-activation client — the editor's only call to the licensing
 * backend.
 *
 * `POST {edge}/vpp-licenses/activate` with `{ deviceId, packageId }` answers
 * `{ licensed, deviceId, vppId, license }`, where `license` is the signed 98-byte
 * blob base64-encoded. The route is PUBLIC and rate-limited: the editor has no
 * login, and authorization is the seat/entitlement check server-side, not a
 * token. It is idempotent — an already-licensed device gets the same blob back
 * without consuming another seat — which is what makes it safe to call on every
 * connect.
 *
 * NO PROOF OF POSSESSION. The activate body carries no nonce or signature. What
 * makes that safe is the bare-metal premise: the hardware anchor is read INSIDE
 * the closed license-core and the blob is bound to `deviceId`, so a blob only
 * ever runs FULL on the silicon it names. Handing one to whoever knows the id
 * benefits nobody with different hardware.
 *
 * WHAT THAT COSTS, EXPLICITLY: `/activate` is a blob distributor keyed on a
 * PUBLIC identifier, which allows early harvesting (collect blobs now, use them
 * the day forging an identity gets cheap) and works as an inventory oracle. Both
 * are accepted, and both depend on the anchor staying unforgeable.
 *
 * NO DEV MOCK. An earlier revision carried a dev-build-only signer
 * (`OPLC_LICENSE_MOCK` / `OPLC_LICENSE_MOCK_KEY`) that minted real, device-bound
 * blobs locally. It is deliberately absent: the local test path now runs the REAL
 * backend against the REAL per-VPP key (see `scripts/seed-vpp-licensing-local.ts`
 * in autonomy-edge), so the mock bought nothing a developer needs while putting a
 * license-minting path one key leak away from unlimited offline licenses. Point
 * `OPENPLC_EDGE_API_URL` at the local backend instead — `httpModuleFor` makes a
 * plain-http base URL work.
 *
 * Runs main-side: uses `node:http`/`node:https` and the same base-URL /
 * `{ statusCode, data }` envelope conventions as the library catalog client.
 */

import { LIC_BLOB_SIZE } from '../../shared/debug/license-blob'
import { getEdgeApiBaseUrl } from '../library-manager/desktop-catalog-transport'
import { defaultPortFor, httpModuleFor } from '../utils/http-module'

/**
 * Input to `checkDeviceActivation` — exactly the two fields the wire accepts.
 *
 * There is deliberately no `vppId` or `keyId` here. Both existed only to feed the
 * removed dev signer: `ActivateVppLicenseDto` has no such field, and the backend
 * derives its own product and signing-key material from `packageId`. Keeping them
 * would advertise a choice the caller does not have.
 */
export interface DeviceActivationInput {
  /** 16-byte device id, LOWERCASE hex (from `deriveDeviceId`). */
  deviceId: string
  /** VPP package id (e.g. `com.openplc.espressif-licensed`) — `package.id`. */
  packageId: string
}

/**
 * Result of an activation check. Best-effort: transport / backend errors surface
 * as `{ licensed: false, error }` rather than throwing, so the licensing routine
 * can degrade without a hard failure.
 *
 * `reason` and `error` are SEPARATE on purpose and callers must keep them apart.
 * `reason` is the backend's business answer ("no purchase on record") and means
 * demo mode is correct. `error` means we never got an answer — a 429 from the
 * rate limiter, a 503 when no signer is configured, a 404 for an unknown package,
 * a dropped connection. Collapsing the two tells someone who already owns a
 * license to go buy one.
 */
export interface DeviceActivationResult {
  licensed: boolean
  /** License blob bytes (98 B) when `licensed` — ready to write via FC 0x49. */
  license?: number[]
  /** Backend-supplied reason (e.g. "no active subscription"). */
  reason?: string
  /** Populated on transport / backend failure (best-effort path). */
  error?: string
}

/** The exact JSON body `ActivateVppLicenseDto` accepts. */
interface EdgeActivationRequestBody {
  deviceId: string
  packageId: string
}

/** Response shape from the edge activation endpoint. */
interface EdgeActivationResponse {
  licensed: boolean
  /** 98-byte license blob, base64-encoded. */
  license?: string
  reason?: string
}

const ACTIVATE_PATH = '/vpp-licenses/activate'
const REQUEST_TIMEOUT_MS = 30_000

/**
 * Ask the backend whether this device is entitled to a license for this VPP, and
 * get the signed blob when it is.
 *
 * Any failure (route missing → 404, network, non-2xx, bad JSON, wrong blob size)
 * resolves to `{ licensed: false, error }` — never throws.
 */
export async function checkDeviceActivation(input: DeviceActivationInput): Promise<DeviceActivationResult> {
  try {
    const body: EdgeActivationRequestBody = { deviceId: input.deviceId, packageId: input.packageId }
    const raw = await postJson(`${getEdgeApiBaseUrl()}${ACTIVATE_PATH}`, body)
    const data = unwrapHttpEnvelope(raw) as Partial<EdgeActivationResponse> | undefined

    if (!data || typeof data.licensed !== 'boolean') {
      return { licensed: false, error: 'Unexpected activation response shape' }
    }
    if (!data.licensed) return { licensed: false, reason: data.reason }
    if (typeof data.license !== 'string') {
      return { licensed: false, error: 'Activation response missing license blob' }
    }

    // `Buffer.from(s, 'base64')` NEVER throws: the decoder silently skips invalid
    // characters and tolerates missing padding, so a truncated or corrupted field
    // yields a SHORT buffer instead of an error. Writing that to the device
    // produces a LIC_CORRUPT rejection whose message points at the hardware,
    // giving no hint that the backend sent something malformed. Check the length.
    const blob = Buffer.from(data.license, 'base64')
    if (blob.length !== LIC_BLOB_SIZE) {
      return {
        licensed: false,
        error: `Activation response license blob is ${blob.length} bytes, expected ${LIC_BLOB_SIZE}`,
      }
    }

    return { licensed: true, license: Array.from(blob), reason: data.reason }
  } catch (err) {
    return { licensed: false, error: err instanceof Error ? err.message : String(err) }
  }
}

function postJson(url: string, body: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const payload = JSON.stringify(body)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(payload)),
      Accept: 'application/json',
      'User-Agent': 'OpenPLC-Editor/license-activation',
    }
    // Sent when available. The route is anonymous today; an account token, when
    // there is an authority to issue one, ties the purchase to a user. Without it
    // the request still goes out and a 401/404 lands on the best-effort path.
    const token = process.env.OPENPLC_EDGE_TOKEN?.trim()
    if (token) headers.Authorization = `Bearer ${token}`

    // Scheme-driven, so OPENPLC_EDGE_API_URL can point at a local http backend
    // for end-to-end testing. Production hosts stay https either way.
    const req = httpModuleFor(parsed).request(
      {
        hostname: parsed.hostname,
        port: parsed.port || defaultPortFor(parsed),
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers,
      },
      (res) => {
        let responseBody = ''
        res.setEncoding('utf-8')
        res.on('data', (chunk: string) => {
          responseBody += chunk
        })
        res.on('end', () => {
          const status = res.statusCode ?? 0
          if (status < 200 || status >= 300) {
            reject(new Error(`Activation request failed: ${status} ${res.statusMessage ?? ''}`.trim()))
            return
          }
          try {
            resolve(JSON.parse(responseBody))
          } catch (err) {
            reject(
              new Error(`Activation response was not valid JSON: ${err instanceof Error ? err.message : String(err)}`),
            )
          }
        })
      },
    )

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`Activation request timed out after ${REQUEST_TIMEOUT_MS}ms`))
    })
    req.on('error', (err) => reject(err))
    req.write(payload)
    req.end()
  })
}

/** autonomy-edge wraps JSON responses in `{ statusCode, data }`. Unwrap once so
 *  callers see the payload; off-spec responses fall through unchanged. */
function unwrapHttpEnvelope(raw: unknown): unknown {
  if (raw && typeof raw === 'object' && 'data' in raw && 'statusCode' in raw) {
    return (raw as { data: unknown }).data
  }
  return raw
}
