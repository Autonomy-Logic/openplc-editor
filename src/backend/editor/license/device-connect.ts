/**
 * Persistent-connection probe + license recover (D72), operating over an
 * ALREADY-CONNECTED `LicenseCapableTransport`: it neither connects nor
 * disconnects — the caller holds the client open for the live serial link, so
 * classification, the on-device license read (0x4A), and the auto-recover
 * (derive -> backend -> write 0x49) all happen over a SINGLE port open.
 *
 * Pure orchestration over the transport + the activation client, so it is
 * unit-testable with mocks. Never throws — failures resolve to a status.
 */
import { getErrorMessage } from '../../../frontend/utils/get-error-message'
import { crc32IsoHdlc, deserializeLicenseBlob, LIC_BLOB_SIZE, LIC_MAGIC_LE } from '../../shared/debug/license-blob'
import type { LicenseCapableTransport } from '../../shared/debug/types'
import { deriveDeviceId, deriveVppId } from './device-identity'
import { deriveDeviceKeyPair } from './device-keypair'
import { checkDeviceActivation } from './license-activation-client'
import { type DeviceLicenseStatus, readBoardIdWithRetries } from './license-probe'

export type DeviceConnectStatus = 'connected-with-firmware' | 'no-firmware' | 'no-response' | 'error'

/** What the recover step did (only when the target is licensable). */
export type DeviceActivationSummary = 'already-licensed' | 'activated' | 'demo' | 'unsupported' | 'error'

export interface DeviceConnectResult {
  status: DeviceConnectStatus
  /** Present when a firmware answered 0x48: the raw hardware id, lowercase hex. */
  anchorHex?: string
  /**
   * The licensing identity derived from the anchor (`deriveDeviceId`), 32 hex
   * chars — the id the backend stores a license against and the one a purchase
   * must be bound to. Derived here, in main, because `node:crypto` is main-only;
   * the renderer cannot compute it and must be handed the value (it feeds the
   * license detail popover and the buy deep link). Present whenever `anchorHex`
   * is, licensable or not: it is a pure function of the anchor.
   */
  deviceId?: string
  /**
   * Raw Ed25519 public key (32 bytes hex) of this device's proof-of-possession
   * keypair (ADR-0002), derived from the anchor. Present on the results where the
   * UI can offer "Buy license" — the purchase link carries it, and the purchase
   * is the only moment that binds a key to a device.
   *
   * Absent when the board is not licensable (nothing to buy), when it already
   * holds a valid license (same), or when the derivation itself failed. Only the
   * PUBLIC half ever leaves this process; the private key is never stored and
   * never transmitted.
   */
  devicePublicKey?: string
  /** On-device license state after the (optional) recover. */
  licenseStatus?: DeviceLicenseStatus
  /** What the recover attempt concluded (licensable targets only). */
  activation?: DeviceActivationSummary
  /**
   * Whether the activate request carried proof of possession (ADR-0002).
   *
   * Present only when the backend was actually asked. `'unproven'` means the
   * request went WITHOUT a signature — no `/challenge` route (404) or no anchor —
   * so a `demo` conclusion here cannot be read as "there is no purchase": a
   * backend that requires the proof refuses with the byte-identical answer.
   * Carried out to the renderer because the alternative was a `console.warn` in
   * the main process, which no user ever sees, and the visible result was a
   * paying customer being told to buy again (A19).
   */
  proofOfPossession?: 'proved' | 'unproven'
  error?: string
}

/** SUCCESS status byte of a read-license (0x4A) response = a stored license. */
const LIC_STATUS_SUCCESS = 0x7e
/** LIC_UNSUPPORTED status byte (no on-device storage backend). */
const LIC_STATUS_UNSUPPORTED = 0x85
/** crc32 covers `[payload || signature]` = offsets 0..93; it never covers itself. */
const LIC_CRC_COVERAGE = 94

/**
 * Verify a blob the device handed back on 0x4A: magic, crc32, `device_id` and
 * `product_id` (D2).
 *
 * WHY THIS EXISTS. The `0x7E` status byte does NOT mean "the stored license is
 * good" — the two targets disagree about what it means. Bare metal validates
 * magic + crc32 inside `license_store_read`; the Linux runtime's
 * `vpp_license_debug.py` checks ONLY that the file is 98 bytes long. So on a Pi
 * a blob cloned from another board, or a half-written file, answers `0x7E`, and
 * the caller used to return `already-licensed` and NEVER ASK THE BACKEND —
 * skipping the one automatic repair path there is. The closed `license-core`
 * then refuses the blob (CORRUPT / DEVICE_MISMATCH) and the board runs demo and
 * stops actuating 15 minutes in, while the badge says "Licensed".
 *
 * WHAT IT DOES AND DOES NOT PROVE. It proves the bytes are a well-formed license
 * FOR THIS DEVICE AND THIS VPP: length, magic, crc32 over 0..93, the 16-byte
 * `device_id` equal to the id derived from the anchor we just read, and the
 * 8-byte `product_id` equal to the id derived from this package. It does NOT
 * verify the ECDSA signature or the `key_id`, so it cannot say the closed gate
 * will run FULL — only `license_core_verify` can, and asking it is a separate
 * project (D2, "Rejeitado"). Anything asserted in the UI must stay inside this
 * boundary.
 *
 * `product_id` is only checked when a `packageId` is known; without one there is
 * nothing to compare against and the field is left unverified rather than
 * assumed good.
 *
 * Deliberately built on `license-blob.ts` (`deserializeLicenseBlob`,
 * `crc32IsoHdlc`) instead of a second parser: that module is byte-identical with
 * openplc-web, cross-pinned to the C struct by a golden vector, and a private
 * re-implementation here is exactly the divergence risk D54 exists to kill.
 */
export function verifyStoredLicenseBlob(
  blob: Uint8Array | undefined,
  deviceIdHex: string,
  packageId: string | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (!blob || blob.length !== LIC_BLOB_SIZE) {
    // A 0x7E with no (or a short) blob is itself off-contract: the parser only
    // fills `blob` when the device sent all `len` bytes. Treat as unverified.
    return { ok: false, reason: `stored license is ${blob?.length ?? 0} bytes, expected ${LIC_BLOB_SIZE}` }
  }
  const parsed = deserializeLicenseBlob(blob)
  if (parsed.magic !== LIC_MAGIC_LE) {
    return { ok: false, reason: 'stored license has no OPLC magic' }
  }
  const expectedCrc = crc32IsoHdlc(blob.subarray(0, LIC_CRC_COVERAGE))
  if (parsed.crc32 !== expectedCrc) {
    return { ok: false, reason: 'stored license fails its crc32 (truncated or corrupted)' }
  }
  const blobDeviceId = bytesToHex(parsed.deviceId)
  if (blobDeviceId !== deviceIdHex) {
    // The clone case: valid bytes, wrong board. The gate answers DEVICE_MISMATCH.
    return { ok: false, reason: `stored license is bound to device ${blobDeviceId}, not ${deviceIdHex}` }
  }
  if (packageId) {
    const expectedProductId = deriveVppId(packageId)
    const blobProductId = bytesToHex(parsed.productId)
    if (blobProductId !== expectedProductId) {
      return { ok: false, reason: `stored license is for product ${blobProductId}, not ${expectedProductId}` }
    }
  }
  return { ok: true }
}

function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  return out
}

/**
 * Classify the connected device and, for a licensable target, recover its
 * license from the backend when absent. Assumes `client` is already connected;
 * the caller owns its lifecycle (this never disconnects it).
 */
export async function probeAndRecover(
  client: LicenseCapableTransport,
  opts: { isLicensable?: boolean; packageId?: string; keyId?: string },
): Promise<DeviceConnectResult> {
  try {
    const anchor = await readBoardIdWithRetries(client, { attempts: 6, backoffMs: 500 })
    if (!anchor.success || !anchor.anchor || anchor.anchor.length === 0) {
      // Channel opened but nothing spoke the debug protocol -> blank/non-OpenPLC.
      return { status: 'no-firmware' }
    }
    const anchorHex = anchor.anchorHex
    // Derived up front, not inside the recover branch: every connected result
    // carries it, so the renderer can show and copy the licensing identity even
    // when no recover ran (already licensed, unsupported storage, no packageId).
    // Kept as bytes: `deviceId` is a one-way hash of these, and the recover step
    // needs the PRE-IMAGE to prove possession (ADR-0002). The bytes never leave
    // this process — only a signature derived from them does.
    const anchorBytes = Uint8Array.from(anchor.anchor)
    const deviceId = deriveDeviceId(anchorBytes)

    // Free VPP — no licensing step.
    if (!opts.isLicensable) return { status: 'connected-with-firmware', anchorHex, deviceId }

    const lic = await client.readLicense()
    if (lic.status === LIC_STATUS_SUCCESS) {
      // 0x7E only means "the device had something to give us" — the Linux runtime
      // checks nothing but the 98-byte length (D2/A2). Verify the bytes here
      // before believing them; a blob that fails FALLS THROUGH to the recover
      // below, which is the only automatic way this device gets a good license.
      const verdict = verifyStoredLicenseBlob(lic.blob, deviceId, opts.packageId)
      if (verdict.ok) {
        // A license bound to THIS device and THIS VPP is already stored, and its
        // magic + crc32 check out — nothing to recover. (Not a signature check:
        // see `verifyStoredLicenseBlob`.)
        return {
          status: 'connected-with-firmware',
          anchorHex,
          deviceId,
          licenseStatus: 'licensed',
          activation: 'already-licensed',
        }
      }
      console.warn(
        `[license] the device reported a stored license but it did not verify (${verdict.reason}) — ` +
          'treating it as absent and attempting recovery.',
      )
    }
    if (lic.status === LIC_STATUS_UNSUPPORTED || lic.unsupported) {
      // Declares isLicensable but has no on-device storage backend.
      return {
        status: 'connected-with-firmware',
        anchorHex,
        deviceId,
        licenseStatus: 'unsupported',
        activation: 'unsupported',
      }
    }

    // Empty / corrupt on-device license -> attempt recover. Needs the package id.
    // From here on the device may end up needing a PURCHASE, and every purchase
    // link must carry the public key (ADR-0002) — so each return below carries it.
    if (!opts.packageId) {
      return {
        status: 'connected-with-firmware',
        anchorHex,
        deviceId,
        devicePublicKey: await derivePublicKeyForPurchase(anchorBytes, deviceId),
        licenseStatus: 'unlicensed',
      }
    }

    const vppId = deriveVppId(opts.packageId)
    const act = await checkDeviceActivation({
      deviceId,
      vppId,
      packageId: opts.packageId,
      keyId: opts.keyId,
      anchor: anchorBytes,
    })
    // Reuse the key the proof already derived; only derive again when there was
    // no proof (no challenge route, or the request never got that far). The KDF
    // is memory-hard by design, so paying it twice per connect is not free.
    const devicePublicKey = act.devicePublicKey ?? (await derivePublicKeyForPurchase(anchorBytes, deviceId))
    // Rides on EVERY branch below, because the branch that needs it most is the
    // one that looks most like a settled answer: `demo`. An unproven request that
    // the backend refuses is indistinguishable, on the wire, from "this device
    // never bought anything" — so without this the renderer would keep telling a
    // paying customer to buy again (A19, D6).
    const proofOfPossession = act.proofOfPossession

    if (!act.licensed) {
      // A transport/backend failure is NOT the same as "no purchase on record".
      // Collapsing both into `demo` makes the renderer tell someone who already
      // owns a license to buy one: the activate endpoint is rate-limited (429),
      // answers 503 when no signer is configured, 404 for an unknown package,
      // and any dropped connection lands here too. `checkDeviceActivation`
      // already separates `reason` (business) from `error` (transport) -- honour
      // the distinction instead of discarding it one layer up.
      if (act.error) {
        return {
          status: 'connected-with-firmware',
          anchorHex,
          deviceId,
          devicePublicKey,
          licenseStatus: 'unlicensed',
          activation: 'error',
          proofOfPossession,
          error: act.error,
        }
      }
      // No license for this device on the backend's word -> demo. The renderer
      // prompts buy — UNLESS the request went unproven, in which case "no
      // license" is not something the backend actually told us.
      return {
        status: 'connected-with-firmware',
        anchorHex,
        deviceId,
        devicePublicKey,
        licenseStatus: 'unlicensed',
        activation: 'demo',
        proofOfPossession,
      }
    }

    if (act.license) {
      const write = await client.writeLicense(Uint8Array.from(act.license))
      if (write.unsupported) {
        return {
          status: 'connected-with-firmware',
          anchorHex,
          deviceId,
          licenseStatus: 'unsupported',
          activation: 'unsupported',
          proofOfPossession,
        }
      }
      if (write.success) {
        // RE-READ, don't trust the write (A16). 0x49 only STORES bytes: it does
        // not check magic, crc32, `device_id` or `product_id` on any target
        // (`vpp_license_debug.py` writes the file straight through; bare metal
        // validates on READ, not on write). So `write.success` alone said nothing
        // about what the board now holds, and the UI used to assert possession
        // from it — a blob signed for another `device_id`, or truncated in
        // flight, would have read "Licensed" while the board ran demo. This is
        // the same check `scripts/probe-pi-license.ts` already did and the app
        // did not.
        const stored = await client.readLicense()
        const verdict = !stored.success
          ? ({ ok: false, reason: `the read-back failed (${stored.error ?? 'no reply'})` } as const)
          : verifyStoredLicenseBlob(
              stored.status === LIC_STATUS_SUCCESS ? stored.blob : undefined,
              deviceId,
              opts.packageId,
            )
        if (verdict.ok) {
          return {
            status: 'connected-with-firmware',
            anchorHex,
            deviceId,
            licenseStatus: 'licensed',
            activation: 'activated',
            proofOfPossession,
          }
        }
        return {
          status: 'connected-with-firmware',
          anchorHex,
          deviceId,
          devicePublicKey,
          licenseStatus: 'unlicensed',
          activation: 'error',
          proofOfPossession,
          error: `the license was written but could not be confirmed on the device: ${verdict.reason}`,
        }
      }
      return {
        status: 'connected-with-firmware',
        anchorHex,
        deviceId,
        devicePublicKey,
        licenseStatus: 'unlicensed',
        activation: 'error',
        proofOfPossession,
        error: write.error,
      }
    }

    // Licensed but the backend returned no blob — nothing to write; run as demo.
    return {
      status: 'connected-with-firmware',
      anchorHex,
      deviceId,
      devicePublicKey,
      licenseStatus: 'unlicensed',
      activation: 'demo',
      proofOfPossession,
    }
  } catch (error) {
    return { status: 'error', error: getErrorMessage(error) }
  }
}

/**
 * The public half of the device keypair, for the purchase link — or `undefined`
 * when it cannot be produced.
 *
 * Swallows the failure on purpose. This runs inside a connect flow whose job is
 * to classify a board: a KDF that fails (an anchor the derivation refuses, a
 * memory limit) must not turn a working connection into an error. The cost of
 * returning nothing is a purchase that binds no key — the device is then served
 * as before and says so loudly on the backend — while throwing here would cost
 * the connection itself.
 */
async function derivePublicKeyForPurchase(anchor: Uint8Array, deviceId: string): Promise<string | undefined> {
  try {
    const keyPair = await deriveDeviceKeyPair(anchor, deviceId)
    return keyPair.publicKeyHex
  } catch (error) {
    console.warn(
      `[license] could not derive the device public key (${getErrorMessage(error)}) — a purchase from this ` +
        'connection will not bind one, and the device will activate without proof of possession.',
    )
    return undefined
  }
}

/**
 * The legacy `device:activate-license` (P0-2/D62) outcome shape, kept for
 * `DeviceActivationResult` (shared port surface) back-compat.
 *
 * WHY THIS ADAPTER IS KEPT (decision 2026-07-30, D15 — "S2 fica FORA"). Deleting
 * it and returning `DeviceConnectResult` from both IPC channels was proposed and
 * REJECTED, and the reason has to live here or it will be proposed again with the
 * same (correct-looking) arguments: `success`, `probedAt`, `vppId` and `license`
 * are read by nobody today, and the only consumer reads exactly the
 * `DeviceProbeResult` fields plus `outcome`.
 *
 * The reason it stays: `license: { present, empty, corrupt, unsupported, blob }`
 * — declared on `DeviceActivationResult` in `device-port.ts` — is the ONLY shape
 * in the editor that can express "the blob came back and it is THESE bytes".
 * Nothing reads it yet; task #21 (closing the loop on real Pi hardware) is
 * precisely the next step that may need to inspect the blob a device handed back,
 * and rebuilding this after deleting it would cost the shape AND the channel.
 * The A20 type drift it was blamed for is fixed where it actually was — the
 * declared IPC handler type in `src/main/`.
 */
export interface LegacyActivationOutcome {
  success: boolean
  outcome: 'already-licensed' | 'activated' | 'demo' | 'error' | 'no-id'
  anchorHex?: string
  deviceId?: string
  /** Carried verbatim from the probe so the network path can land the SAME
   *  badge state the serial path does — `outcome` is too coarse for that. */
  licenseStatus?: DeviceLicenseStatus
  activation?: DeviceActivationSummary
  /** Carried for the same reason: the runtime-v4 path reaches the same popover,
   *  and its Buy button needs the key to bind (ADR-0002). */
  devicePublicKey?: string
  /** Carried for the same reason again: the runtime-v4 path shows the same
   *  "License Required" prompt, which must not push a purchase when the request
   *  never carried proof (A19/D6). */
  proofOfPossession?: 'proved' | 'unproven'
  license?: { present: boolean }
  error?: string
}

/**
 * Adapt a `probeAndRecover` result to the legacy one-shot activation outcome
 * (`handleActivateDeviceLicense`), so both IPC handlers share one
 * classify+recover implementation instead of two independently-maintained
 * copies. `deviceId` IS carried through: the runtime-v4 (WebSocket) license
 * check goes through this shape, and its result feeds the same license popover
 * the serial path does — dropping it would leave network targets with no id to
 * show or copy. `vppId`/`license.blob` stay dropped: `DeviceActivationResult`
 * declares them optional and no consumer (frontend or tests) reads them off
 * this response — only `outcome`/`anchorHex`/`deviceId` drive the UI.
 */
export function toLegacyActivationOutcome(result: DeviceConnectResult): LegacyActivationOutcome {
  switch (result.status) {
    case 'no-firmware':
      return { success: true, outcome: 'no-id' }
    case 'no-response':
      return { success: false, outcome: 'error', error: result.error ?? 'device did not respond' }
    case 'error':
      return { success: false, outcome: 'error', error: result.error }
    case 'connected-with-firmware':
      return mapConnectedActivation(result)
  }
}

function mapConnectedActivation(result: DeviceConnectResult): LegacyActivationOutcome {
  const anchorHex = result.anchorHex
  const deviceId = result.deviceId
  // Passed through on every branch: the renderer decides what to show from
  // these, not from `outcome`, which cannot express "storage unsupported" and
  // "the backend never answered" as different things. `devicePublicKey` rides
  // along for the same reason — dropping it would leave the network path's Buy
  // button building a link that binds no key.
  const carried = {
    licenseStatus: result.licenseStatus,
    activation: result.activation,
    devicePublicKey: result.devicePublicKey,
    proofOfPossession: result.proofOfPossession,
  }
  switch (result.activation) {
    case 'already-licensed':
      return { success: true, outcome: 'already-licensed', anchorHex, deviceId, ...carried, license: { present: true } }
    case 'activated':
      return { success: true, outcome: 'activated', anchorHex, deviceId, ...carried, license: { present: true } }
    case 'demo':
      return { success: true, outcome: 'demo', anchorHex, deviceId, ...carried }
    case 'unsupported':
      return {
        success: true,
        outcome: 'error',
        anchorHex,
        deviceId,
        ...carried,
        error: 'no on-device storage backend',
      }
    case 'error':
      return {
        success: true,
        outcome: 'error',
        anchorHex,
        deviceId,
        ...carried,
        error: result.error ?? 'License write failed',
      }
    default:
      // Reachable: `probeAndRecover` returns without `activation` when it has
      // no packageId to derive from (an empty string from the renderer passes
      // the `packageId: string` type — IPC arguments are not validated at the
      // boundary). Treated as an error rather than demo: we never asked the
      // backend anything, so we know nothing about this device's entitlement.
      return {
        success: true,
        outcome: 'error',
        anchorHex,
        deviceId,
        ...carried,
        error: 'no package id: cannot check licensing',
      }
  }
}
