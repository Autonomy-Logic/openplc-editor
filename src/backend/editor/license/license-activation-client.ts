/**
 * Device license-activation client (PLA-06).
 *
 * HYBRID design (design.md §4): the **real** autonomy-edge client is wired
 * up now, behind a dev **toggle** that injects a mocked response so both
 * code paths are testable today — the real `vpp-licenses/activate` route
 * does not exist on the edge yet (only billing/Paddle/subscriptions do).
 *
 * TODO(D49/D51): remover o toggle quando o modulo vpp-licenses do
 * autonomy-edge existir.
 *
 * Runs main-side: uses `node:https` + the same base-URL / `{ statusCode,
 * data }` envelope conventions as the library catalog client.
 */

import https from 'https'

import { serializeLicenseBlob } from '../../shared/debug/license-blob'
import { getEdgeApiBaseUrl } from '../library-manager/desktop-catalog-transport'

/** Request payload sent to the edge activation endpoint. */
export interface DeviceActivationInput {
  /** 16-byte device id, hex (from `deriveDeviceId`). */
  deviceId: string
  /** 8-byte VPP id, hex (from `deriveVppId`). */
  vppId: string
  /** VPP package id (e.g. `com.openplc.espressif`). */
  packageId: string
}

/** Result of an activation check. Best-effort: transport / backend errors
 *  surface as `{ licensed: false, error }` rather than throwing, so the
 *  post-flash routine can degrade to demo mode without a hard failure. */
export interface DeviceActivationResult {
  licensed: boolean
  /** License blob bytes (106 B) when `licensed` — ready to write via FC 0x49. */
  license?: number[]
  /** Backend-supplied reason (e.g. "no active subscription"). */
  reason?: string
  /** Populated on transport / backend failure (best-effort path). */
  error?: string
}

const ACTIVATE_PATH = '/vpp-licenses/activate'
const REQUEST_TIMEOUT_MS = 30_000

/**
 * Check whether a device is entitled to a license for the given VPP.
 *
 * `process.env.OPLC_LICENSE_MOCK` short-circuits the network:
 *   - `'licensed'` → `{ licensed: true, license: <golden 106-byte blob> }`
 *     (exercises the on-device write path).
 *   - `'demo'`     → `{ licensed: false }`.
 *   - absent       → calls the real edge client (§4).
 */
export async function checkDeviceActivation(input: DeviceActivationInput): Promise<DeviceActivationResult> {
  // TODO(D49/D51): remover o toggle quando o modulo vpp-licenses do autonomy-edge existir.
  const mock = process.env.OPLC_LICENSE_MOCK
  if (mock === 'licensed') {
    return { licensed: true, license: goldenLicenseBytes() }
  }
  if (mock === 'demo') {
    return { licensed: false }
  }

  return activateViaEdge(input)
}

// ---------------------------------------------------------------------------
// Real edge client (best-effort)
// ---------------------------------------------------------------------------

/**
 * POST `{base}/vpp-licenses/activate`, unwrapping the edge `{ statusCode,
 * data }` envelope. Any failure (route missing → 404, network, non-2xx,
 * bad JSON) resolves to `{ licensed: false, error }` — never throws.
 */
async function activateViaEdge(input: DeviceActivationInput): Promise<DeviceActivationResult> {
  try {
    const raw = await postJson(`${getEdgeApiBaseUrl()}${ACTIVATE_PATH}`, input)
    const data = unwrapHttpEnvelope(raw) as Partial<DeviceActivationResult> | undefined
    if (!data || typeof data.licensed !== 'boolean') {
      return { licensed: false, error: 'Unexpected activation response shape' }
    }
    return { licensed: data.licensed, license: data.license, reason: data.reason }
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
    // Send the account JWT when one is available; the route will require it
    // once it exists. Without a token the request still goes out (and 401/404
    // → best-effort demo). No edge-account token authority exists yet, so this
    // reads an env override for now.
    const token = process.env.OPENPLC_EDGE_TOKEN?.trim()
    if (token) headers.Authorization = `Bearer ${token}`

    const req = https.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || undefined,
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
            reject(new Error(`Activation response was not valid JSON: ${err instanceof Error ? err.message : err}`))
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

/** autonomy-edge wraps JSON responses in `{ statusCode, data }`. Unwrap once
 *  so callers see the payload; off-spec responses fall through unchanged. */
function unwrapHttpEnvelope(raw: unknown): unknown {
  if (raw && typeof raw === 'object' && 'data' in raw && 'statusCode' in raw) {
    return (raw as { data: unknown }).data
  }
  return raw
}

// ---------------------------------------------------------------------------
// Mock golden blob
// ---------------------------------------------------------------------------

/**
 * The deterministic 106-byte golden license blob, as `number[]`. Built via
 * the shared `serializeLicenseBlob` from the known golden input (the same
 * vector as `on-device-license-storage`'s `license-golden.json`), so the
 * mock exercises a byte-valid on-device write.
 */
function goldenLicenseBytes(): number[] {
  const blob = serializeLicenseBlob({
    magic: 0, // forced to LIC_MAGIC_LE by the serializer
    fmtVersion: 1,
    flags: 0,
    deviceId: Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]),
    productId: Uint8Array.from([160, 161, 162, 163, 164, 165, 166, 167]),
    issuedAt: 1600000000,
    expiresAt: 1784499200,
    signature: new Uint8Array(64).fill(17),
    crc32: 0, // recomputed by the serializer
  })
  return Array.from(blob)
}
