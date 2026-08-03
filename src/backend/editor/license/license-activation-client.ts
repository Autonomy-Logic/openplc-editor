/**
 * Device license-activation client (PLA-06).
 *
 * HYBRID design (design.md §4): the **real** autonomy-edge client is wired
 * up now, behind a **dev-build-only** toggle that injects a mocked response so
 * both code paths are testable today. That toggle is compiled OUT of packaged
 * builds — see `MOCK_ENABLED` below and the security note there; a shipped
 * editor must not contain a license-minting path. The real
 * `POST vpp-licenses/activate` route
 * exists on the `feat/vpp-tables` branch (not yet merged to `development`):
 * `{ deviceId, packageId }` -> `{ licensed, deviceId, vppId, license }` with
 * `license` base64-encoded (98 bytes). Public + rate-limited — no auth token
 * (authorization is the seat/entitlement check server-side, not a login).
 * `vppId`/`keyId` are LOCAL-ONLY (the mock signer's key selector below); the
 * real edge derives its own product/key material from `packageId`.
 *
 * NO PROOF OF POSSESSION (removed 2026-08-03). The activate body used to carry
 * `nonce` + `signature`, obtained from `POST vpp-licenses/challenge` and signed
 * with a keypair derived from the hardware anchor (ADR-0002). It is gone, and the
 * reason it can be gone is the bare-metal premise: the anchor is read INSIDE the
 * closed license-core and the blob is bound to `deviceId`, so a blob only ever
 * runs FULL on the silicon it names. Handing one to whoever knows the id benefits
 * nobody with different hardware.
 *
 * WHAT THAT COSTS, EXPLICITLY: `/activate` becomes a blob distributor keyed on a
 * PUBLIC identifier, which allows early harvesting (collect blobs now, use them
 * the day forging an identity gets cheap) and works as an inventory oracle. Both
 * are accepted, and both depend on the anchor staying unforgeable — see
 * `plano-simplificacao-baremetal.md`.
 *
 * TODO(D49/D51): remover o toggle quando o modulo vpp-licenses do
 * autonomy-edge existir em development.
 *
 * Runs main-side: uses `node:https` + the same base-URL / `{ statusCode,
 * data }` envelope conventions as the library catalog client.
 */

import { sign as cryptoSign } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { LIC_BLOB_SIZE, LIC_PAYLOAD_SIZE, serializeLicenseBlob } from '../../shared/debug/license-blob'
import { getEdgeApiBaseUrl } from '../library-manager/desktop-catalog-transport'
import { defaultPortFor, httpModuleFor } from '../utils/http-module'

/**
 * Input to `checkDeviceActivation`. Only `deviceId` + `packageId` are ever
 * sent over the wire to the real edge (`ActivateVppLicenseDto` has no
 * `vppId`/`keyId` field — the backend derives product/key material from
 * `packageId` itself); `vppId`/`keyId` exist here purely for the LOCAL mock
 * signer, which has no backend to derive them for it.
 */
export interface DeviceActivationInput {
  /** 16-byte device id, hex (from `deriveDeviceId`). */
  deviceId: string
  /** 8-byte VPP id, hex (from `deriveVppId`). Mock-signer only — never sent to the edge. */
  vppId: string
  /** VPP package id (e.g. `com.openplc.espressif`). The only VPP identifier the edge wire accepts. */
  packageId: string
  /**
   * Per-VPP signing key id (manifest `hal.licenseKeyId`, e.g.
   * `raspberry-pi-licensed-2026`), used ONLY to select the mock signer's
   * keystore entry (D69f/P1-3) when `OPLC_LICENSE_MOCK_KEY` is a directory.
   * Mock-signer only — never sent to the edge, which resolves its own signing
   * key from `packageId`.
   */
  keyId?: string
}

/** The exact JSON body the real edge `ActivateVppLicenseDto` accepts. */
interface EdgeActivationRequestBody {
  deviceId: string
  packageId: string
}

/** Result of an activation check. Best-effort: transport / backend errors
 *  surface as `{ licensed: false, error }` rather than throwing, so the
 *  post-flash routine can degrade to demo mode without a hard failure. */
export interface DeviceActivationResult {
  licensed: boolean
  /** License blob bytes (98 B) when `licensed` — ready to write via FC 0x49. */
  license?: number[]
  /** Backend-supplied reason (e.g. "no active subscription"). */
  reason?: string
  /** Populated on transport / backend failure (best-effort path). */
  error?: string
}

const ACTIVATE_PATH = '/vpp-licenses/activate'
const REQUEST_TIMEOUT_MS = 30_000

/**
 * Whether the dev mock signer below exists AT ALL in this build.
 *
 * SECURITY (audit 2026-07-28): this used to be a bare `process.env` read with no
 * build or packaging guard, which meant a SHIPPED editor contained a working
 * license-minting path — `OPLC_LICENSE_MOCK=licensed` plus
 * `OPLC_LICENSE_MOCK_KEY=<private key>` signs a real, device-bound blob that
 * passes the on-device verify. Our private keys are not public, so that was not
 * an immediate break; but it put the mint path in every customer's hands, one key
 * leak away from unlimited offline licenses outside purchase and outside
 * revocation, and it handed an attacker a ready-made harness.
 *
 * A runtime `app.isPackaged` check would still ship the code. This is compared
 * against a LITERAL: webpack's `EnvironmentPlugin` inlines `NODE_ENV` into the
 * main bundle (see `configs/webpack/webpack.config.main.prod.ts`), so in a
 * production build this folds to `false` and the whole mock branch is dead code
 * the minifier removes. Under jest `NODE_ENV` is `test`, so the mock's own tests
 * still exercise it.
 *
 * TODO(D49/D51): delete the mock outright. Its stated condition — "when the
 * autonomy-edge vpp-licenses module exists" — is now met, and the local test
 * environment (`.specs/features/hardware-licensing/local-test/`) runs the real
 * backend, so the mock no longer buys anything a developer needs.
 */
const MOCK_ENABLED = process.env.NODE_ENV !== 'production'

/**
 * Check whether a device is entitled to a license for the given VPP.
 *
 * In non-production builds ONLY, `process.env.OPLC_LICENSE_MOCK` short-circuits
 * the network:
 *   - `'licensed'` → `{ licensed: true, license: <golden 98-byte blob> }`
 *     (exercises the on-device write path; the device rejects it and runs demo),
 *     or a REAL signed blob when `OPLC_LICENSE_MOCK_KEY` supplies a private key.
 *   - `'demo'`     → `{ licensed: false }`.
 *   - absent       → calls the real edge client (§4).
 */
export async function checkDeviceActivation(input: DeviceActivationInput): Promise<DeviceActivationResult> {
  if (MOCK_ENABLED) {
    const mock = process.env.OPLC_LICENSE_MOCK
    if (mock === 'licensed' || mock === 'demo') {
      // Loud on purpose: a dev build left with this set silently stops talking to
      // the real backend, which has already cost debugging time.
      console.warn(`[license] OPLC_LICENSE_MOCK=${mock} — bypassing the real activation endpoint (dev builds only).`)
    }
    if (mock === 'licensed') {
      // With OPLC_LICENSE_MOCK_KEY set to a per-VPP private key PEM, sign a REAL
      // blob for this device so on-device verify passes -> FULL. Without it, fall
      // back to the unsigned golden (exercises the write path only -> device demo).
      const mockKey = process.env.OPLC_LICENSE_MOCK_KEY?.trim()
      if (mockKey) {
        try {
          // keyId (D69f) is the KMS selector: when OPLC_LICENSE_MOCK_KEY is a
          // keystore directory it picks <keyId>.private.pem; a single-file value
          // stays supported for back-compat. This mirrors how the real backend
          // will resolve the per-VPP signing key by keyId.
          const keyPath = resolveMockKeyPath(mockKey, input.keyId)
          return { licensed: true, license: signedMockLicense(input, keyPath) }
        } catch (err) {
          return { licensed: false, error: `mock sign failed: ${err instanceof Error ? err.message : String(err)}` }
        }
      }
      return { licensed: true, license: goldenLicenseBytes() }
    }
    if (mock === 'demo') {
      return { licensed: false }
    }
  }

  return activateViaEdge(input)
}

// ---------------------------------------------------------------------------
// Real edge client (best-effort)
// ---------------------------------------------------------------------------

/** Response shape from the real edge activation/recover endpoints. */
interface EdgeActivationResponse {
  licensed: boolean
  /** 98-byte license blob, base64-encoded. */
  license?: string
  reason?: string
}

/**
 * POST `{base}/vpp-licenses/activate`, unwrapping the edge `{ statusCode,
 * data }` envelope. Any failure (route missing → 404, network, non-2xx,
 * bad JSON) resolves to `{ licensed: false, error }` — never throws. Sends
 * ONLY `{ deviceId, packageId }` — the real `ActivateVppLicenseDto` has no
 * `vppId`/`keyId` field.
 */
async function activateViaEdge(input: DeviceActivationInput): Promise<DeviceActivationResult> {
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
    // `Buffer.from(s, 'base64')` NEVER throws: the decoder silently skips
    // invalid characters and tolerates missing padding, so a truncated or
    // corrupted field yields a short buffer instead of an error. Writing that
    // to the device produces a LIC_CORRUPT rejection whose message points at
    // the hardware, giving no hint that the backend sent something malformed.
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
    // Send the account JWT when one is available; the route will require it
    // once it exists. Without a token the request still goes out (and 401/404
    // → best-effort demo). No edge-account token authority exists yet, so this
    // reads an env override for now.
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
 * The deterministic 98-byte golden license blob, as `number[]`. Built via
 * the shared `serializeLicenseBlob` from the known golden input (the same
 * vector as `on-device-license-storage`'s `license-golden.json`), so the
 * mock exercises a byte-valid on-device write.
 */
function goldenLicenseBytes(): number[] {
  const blob = serializeLicenseBlob({
    magic: 0, // forced to LIC_MAGIC_LE by the serializer
    fmtVersion: 1,
    keyId: 0,
    deviceId: Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]),
    productId: Uint8Array.from([160, 161, 162, 163, 164, 165, 166, 167]),
    signature: new Uint8Array(64).fill(17),
    crc32: 0, // recomputed by the serializer
  })
  return Array.from(blob)
}

/** Convert a hex string (e.g. deriveDeviceId output) to bytes. */
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim()
  const out = new Uint8Array(Math.floor(clean.length / 2))
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}

/**
 * DEV mock signer. Signs a REAL 98-byte license blob bound to THIS device using
 * a per-VPP P-256 private key at `keyPath` (OPLC_LICENSE_MOCK_KEY). Mirrors the
 * backend's future job: build the 30-byte payload, ECDSA P-256 over sha256 as
 * raw r||s (ieee-p1363), then the blob with crc32. The blob then verifies
 * on-device against the VPP's public key baked in the .a -> FULL. Dev-only; the
 * private key is a local file, never committed.
 */
/**
 * Resolve the private-key file the mock signs with. `OPLC_LICENSE_MOCK_KEY` is
 * either a single PEM file (back-compat) or a KEYSTORE DIRECTORY, in which case
 * the request's `keyId` (D69f, the KMS selector) names the key:
 * `<dir>/<keyId>.private.pem`. This makes `keyId` the effective selector when a
 * store is provided, exactly as the real backend/KMS will resolve it.
 */
function resolveMockKeyPath(mockKey: string, keyId: string | undefined): string {
  let isDir = false
  try {
    isDir = statSync(mockKey).isDirectory()
  } catch {
    /* not stat-able -> treat as a plain file path below */
  }
  if (isDir) {
    if (!keyId) {
      throw new Error(
        'OPLC_LICENSE_MOCK_KEY is a keystore directory but the request carries no keyId to select the per-VPP key',
      )
    }
    return join(mockKey, `${keyId}.private.pem`)
  }
  return mockKey
}

function signedMockLicense(input: DeviceActivationInput, keyPath: string): number[] {
  const privateKeyPem = readFileSync(keyPath, 'utf8')
  const deviceId = hexToBytes(input.deviceId) // 16 bytes (from deriveDeviceId)
  const productId = hexToBytes(input.vppId) //    8 bytes (from deriveVppId)

  // NOTE: the blob's `keyId` byte is the INDEX into the VPP's embedded
  // trusted_keys.h (one key per VPP today -> index 0), which is distinct from
  // the request's `keyId` STRING (the KMS key name that selected this private
  // key). Rotation would bump this index; per-VPP single key stays 0.
  //
  // Serialize once with a placeholder signature so we sign the EXACT payload the
  // serializer lays out (offsets 0..29), independent of layout details.
  const draft = serializeLicenseBlob({
    magic: 0,
    fmtVersion: 1,
    keyId: 0,
    deviceId,
    productId,
    signature: new Uint8Array(64),
    crc32: 0,
  })
  const payload = draft.subarray(0, LIC_PAYLOAD_SIZE)

  // `payload` is already a Uint8Array (BinaryLike); pass it directly. Wrapping it
  // in Buffer.from tripped a @types/node<->TS ArrayBufferView mismatch that broke
  // this module's type-check (and its test suite).
  const sig = new Uint8Array(cryptoSign('sha256', payload, { key: privateKeyPem, dsaEncoding: 'ieee-p1363' }))
  if (sig.length !== 64) throw new Error(`expected 64-byte r||s signature, got ${sig.length}`)

  const blob = serializeLicenseBlob({
    magic: 0,
    fmtVersion: 1,
    keyId: 0,
    deviceId,
    productId,
    signature: sig,
    crc32: 0,
  })
  return Array.from(blob)
}
