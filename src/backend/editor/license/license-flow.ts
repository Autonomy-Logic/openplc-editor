/**
 * The VPP licensing machine: read what the device holds, decide whether to
 * believe it, and recover from the backend when it is absent or wrong.
 *
 * Runs over an ALREADY-CONNECTED transport — it neither connects nor
 * disconnects. The caller holds the link open, so classification, the on-device
 * read (0x4A), the backend call and the write (0x49) all happen over a SINGLE
 * port open. Pure orchestration over the transport plus the activation client, so
 * it is unit-testable with mocks, and it never throws: every failure resolves to
 * an outcome.
 *
 * Lives under `backend/editor` rather than the byte-identical `backend/shared`
 * surface because it depends on `deriveDeviceId`, which needs `node:crypto`.
 */

import type { DeviceLicenseReport, DeviceLicenseState } from '../../../middleware/shared/ports/device-port'
import { crc32IsoHdlc, deserializeLicenseBlob, LIC_BLOB_SIZE, LIC_MAGIC_LE } from '../../shared/debug/license-blob'
import type { DebugLicenseReadResult, DebugLicenseWriteResult } from '../../shared/debug/types'
import { deriveDeviceId, deriveVppId, DEVICE_ID_BYTES } from './device-identity'
import { checkDeviceActivation } from './license-activation-client'

/** Just enough of a transport to run the licensing FCs. */
export interface LicenseReadWritable {
  readLicense(): Promise<DebugLicenseReadResult>
  writeLicense(blob: Uint8Array): Promise<DebugLicenseWriteResult>
}

/** SUCCESS status byte of a read-license (0x4A) response = a stored license. */
const LIC_STATUS_SUCCESS = 0x7e
/** LIC_UNSUPPORTED status byte (no on-device storage backend). */
const LIC_STATUS_UNSUPPORTED = 0x85
/** crc32 covers `[payload || signature]` = offsets 0..93; it never covers itself. */
const LIC_CRC_COVERAGE = 94

/**
 * The outcome shape is the PORT's `DeviceLicenseState`, not a private one.
 *
 * Deliberately not a second type mapped at the IPC boundary: the union's whole
 * value is that `unlicensed` (the backend says there is no purchase) and
 * `check-failed` (we could not find out) cannot be collapsed into each other, and
 * a hand-written mapper between two near-identical unions is exactly where that
 * distinction gets quietly lost. One type, one meaning, all the way to the badge.
 */
export type { DeviceLicenseReport, DeviceLicenseState }

/**
 * What FC 0x48 answered, and WHICH KIND of value it is (DOPE-589).
 *
 * The two platforms report different things and the difference decides whether
 * this side hashes or not, so it is carried in the type rather than in a
 * comment:
 *
 *   - `device-id`: BARE METAL. The closed license-core read the silicon and
 *     derived the id itself (`license_gate_device_id`), so it is used AS IS.
 *     Hashing it again would produce an identity no licence was ever issued for
 *     and no device can reproduce.
 *   - `anchor`: RUNTIME-V4. The raw device-tree serial, already stripped of its
 *     trailing bytes on the wire, from which the editor derives the device_id
 *     with `deriveDeviceId`.
 *
 * A single `Uint8Array` field would type-check either way and silently do the
 * wrong thing on one of them, which is precisely the failure this shape exists
 * to make impossible.
 */
export type DeviceIdentity = { kind: 'device-id'; deviceId: Uint8Array } | { kind: 'anchor'; anchor: Uint8Array }

export interface DeviceLicenseInput {
  /** What the identity read (FC 0x48) returned, tagged with its kind. */
  identity: DeviceIdentity
  /** Reverse-domain VPP package id (`package.id`) from `resolveLicensingTarget`. */
  packageId: string
}

/**
 * Verify a blob the device handed back on 0x4A: magic, crc32, `deviceId` and
 * `productId`.
 *
 * WHY THIS EXISTS. The `0x7E` status byte does NOT mean "the stored license is
 * good" — the two targets disagree about what it means. Bare metal validates
 * magic + crc32 inside its store read; the Linux runtime checks ONLY that the
 * file is 98 bytes long. So on a Pi a blob cloned from another board, or one
 * half-written, answers `0x7E`. A caller that believed it would report
 * `already-licensed` and NEVER ASK THE BACKEND — skipping the one automatic
 * repair path there is. The closed license-core then refuses the blob and the
 * board runs demo, stopping actuation two hours in, while the badge says
 * "Licensed".
 *
 * WHAT IT PROVES AND WHAT IT DOES NOT. It proves the bytes are a well-formed
 * license FOR THIS DEVICE AND THIS VPP: length, magic, crc32 over 0..93, the
 * 16-byte `deviceId` equal to the id derived from the anchor we just read, and
 * the 8-byte `productId` equal to the id derived from this package. It does NOT
 * verify the ECDSA signature or the `keyId`, so it cannot say the closed gate
 * will run FULL — only the license-core can. Anything asserted in the UI must
 * stay inside that boundary, which is why the badge says "Licensed" (possession)
 * and never "Full mode" (execution).
 *
 * `productId` is checked only when a `packageId` is known; without one there is
 * nothing to compare against and the field is left unverified rather than
 * assumed good.
 *
 * Built on the shared `license-blob.ts` (`deserializeLicenseBlob`,
 * `crc32IsoHdlc`) rather than a second parser: that module is byte-identical
 * with openplc-web and cross-pinned to the C struct by a golden vector. A
 * private re-implementation here is exactly the divergence this avoids.
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
    return { ok: false, reason: 'the stored licence has no OPLC magic' }
  }

  const expectedCrc = crc32IsoHdlc(blob.subarray(0, LIC_CRC_COVERAGE))
  if (parsed.crc32 !== expectedCrc) {
    return { ok: false, reason: 'the stored licence fails its checksum (truncated or corrupted)' }
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
 * Run the licensing step for a licensable board over a live link.
 *
 * The caller has already decided the board is licensable
 * (`resolveLicensingTarget`) and already read its anchor while classifying the
 * link, so no round trip is repeated here.
 *
 * Sequence:
 *   1. Derive `deviceId` from the anchor. No anchor -> `check-failed`.
 *   2. Read 0x4A. `LIC_UNSUPPORTED` -> `unsupported`.
 *   3. If a blob came back, VERIFY it. Good -> `licensed / already-stored`.
 *      Bad -> fall through to recovery, which is the only automatic repair.
 *   4. Ask the backend. No entitlement -> `unlicensed`. Failure -> `check-failed`.
 *   5. Write 0x49, then RE-READ and re-verify. Never trust the write.
 */
export async function resolveDeviceLicense(
  transport: LicenseReadWritable,
  input: DeviceLicenseInput,
): Promise<DeviceLicenseReport> {
  const identity = deriveIdentity(input.identity)
  if ('outcome' in identity) return identity
  const { deviceId } = identity

  try {
    const stored = await readAndVerify(transport, deviceId, input)
    if (stored.kind !== 'absent') return { deviceId, outcome: stored.outcome }

    return await recoverLicense(transport, { deviceId, packageId: input.packageId })
  } catch (error) {
    return { deviceId, outcome: { state: 'check-failed', error: errorMessage(error) } }
  }
}

/**
 * Read what the device is holding and verify it — WITHOUT contacting the backend.
 *
 * Answers "is this board licensed right now?", which is the question the badge
 * asks. Cheap enough for a screen open or a poll, because it is one Modbus frame
 * and some arithmetic.
 *
 * Note what it CANNOT say: `unlicensed` here always carries
 * `entitlementChecked: false`, because nobody has asked whether a purchase
 * exists. A caller that rendered that as "buy a license" would be guessing —
 * offer a refresh instead.
 */
export async function inspectDeviceLicense(
  transport: LicenseReadWritable,
  input: DeviceLicenseInput,
): Promise<DeviceLicenseReport> {
  const identity = deriveIdentity(input.identity)
  if ('outcome' in identity) return identity
  const { deviceId } = identity

  try {
    const stored = await readAndVerify(transport, deviceId, input)
    if (stored.kind === 'absent') {
      return { deviceId, outcome: { state: 'unlicensed', entitlementChecked: false, ...stored.detail } }
    }
    return { deviceId, outcome: stored.outcome }
  } catch (error) {
    return { deviceId, outcome: { state: 'check-failed', error: errorMessage(error) } }
  }
}

/**
 * Derive the licensing identity, or explain why there is none.
 *
 * An identity of zero bytes is a REAL reply, not a failure: a board with no
 * license-core, and one whose architecture the closed reader refuses (AVR,
 * RP2040), answer `id_len = 0`, and the link classifier correctly counts that as
 * "firmware present".
 *
 * It is fatal HERE, and must be caught before deriving anything, because
 * `sha256(prefix || <nothing>)` is a CONSTANT: every such board would share one
 * device id, so one purchase would license an entire fleet and a license issued
 * for one board would verify on all of them.
 */
function deriveIdentity(identity: DeviceIdentity): { deviceId: string } | DeviceLicenseReport {
  const bytes = identity.kind === 'device-id' ? identity.deviceId : identity.anchor
  if (bytes.length === 0) {
    return {
      outcome: {
        state: 'check-failed',
        // Since the packages gate refuses `isLicensable` on silicon the
        // license-core cannot read, a licensable board answering nothing is a
        // FIRMWARE that was built without licensing support — which a rebuild
        // does fix. Says that, instead of naming license-core at a user who has
        // no way to act on the word.
        error:
          'this board did not report an identity a licence can be issued for. ' +
          'Its firmware was built without licensing support — rebuild and upload the program to this board.',
        retryable: false,
      },
    }
  }

  // Bare metal already derived it inside the closed artifact. The length is
  // checked rather than trusted: a short id is not a weaker identity, it is a
  // DIFFERENT one, and a firmware answering the wrong number of bytes must not
  // send a customer to a checkout for an id no device can reproduce.
  if (identity.kind === 'device-id') {
    if (identity.deviceId.length !== DEVICE_ID_BYTES) {
      return {
        outcome: {
          state: 'check-failed',
          // The width belongs in the trace, not on the user's screen: "a 6-byte
          // device id, expected 16" states an internal contract nobody outside
          // this codebase can act on, and it is the FIRST thing a user sees when
          // connecting a board flashed by an older editor. What they can act on
          // is the rebuild. Fail-closed either way: an identity of the wrong
          // width is a DIFFERENT identity, never a weaker one, and buying a
          // licence for it would bind money to an id no device reproduces.
          error:
            "this board's firmware reports its identity in a format this editor does not recognise. " +
            'Rebuild and upload the program to bring the firmware up to date.',
          retryable: false,
        },
      }
    }
    return { deviceId: bytesToHex(identity.deviceId) }
  }

  return { deviceId: deriveDeviceId(identity.anchor) }
}

/**
 * The read-and-verify step both entry points share.
 *
 * `absent` is not an outcome: it means "the device holds nothing usable", and what
 * that IMPLIES differs between the two callers — a refresh recovers from it, an
 * inspect can only report it. Returning a marker instead of an outcome is what
 * keeps that decision at the call site instead of buried here.
 */
type StoredLicenseVerdict =
  | { kind: 'settled'; outcome: DeviceLicenseState }
  | { kind: 'absent'; detail?: { backendReason?: string } }

async function readAndVerify(
  transport: LicenseReadWritable,
  deviceId: string,
  input: DeviceLicenseInput,
): Promise<StoredLicenseVerdict> {
  const stored = await transport.readLicense()

  if (!stored.success) {
    return {
      kind: 'settled',
      outcome: { state: 'check-failed', error: stored.error ?? 'the device did not answer 0x4A' },
    }
  }

  if (stored.status === LIC_STATUS_UNSUPPORTED || stored.unsupported) {
    return { kind: 'settled', outcome: { state: 'unsupported' } }
  }

  if (stored.status === LIC_STATUS_SUCCESS) {
    const verdict = verifyStoredLicenseBlob(stored.blob, deviceId, input.packageId)
    if (verdict.ok) return { kind: 'settled', outcome: { state: 'licensed', how: 'already-stored' } }

    // Deliberately NOT a failure: a stored blob that does not verify is the case
    // recovery exists for (a clone, a half-written file, a licence for another
    // VPP). Treating it as absent is the only automatic way this board gets a
    // good one. Logged because it is worth seeing in the console.
    console.warn(
      `[license] the device reported a stored license but it did not verify (${verdict.reason}) — ` +
        'treating it as absent.',
    )
  }

  return { kind: 'absent' }
}

/**
 * Ask the backend for a license and write it. Reached when the device holds
 * nothing usable — empty, corrupt, or a blob that failed verification.
 */
async function recoverLicense(
  transport: LicenseReadWritable,
  input: { deviceId: string; packageId: string },
): Promise<DeviceLicenseReport> {
  const { deviceId, packageId } = input
  const activation = await checkDeviceActivation({ deviceId, packageId })

  if (!activation.licensed) {
    // A transport/backend failure is NOT the same as "no purchase on record".
    // `checkDeviceActivation` already separates `reason` (business) from `error`
    // (transport); honour the distinction instead of discarding it one layer up.
    if (activation.error) {
      return { deviceId, outcome: { state: 'check-failed', error: activation.error } }
    }
    // The backend WAS asked and said no. `entitlementChecked: true` is what earns
    // the UI the right to offer a purchase.
    return { deviceId, outcome: { state: 'unlicensed', entitlementChecked: true, backendReason: activation.reason } }
  }

  if (!activation.license) {
    // Licensed on the backend's word but no blob to write. Nothing to store, and
    // nothing we can assert about the device — the board will run demo, so say we
    // could not confirm rather than claiming either state.
    return {
      deviceId,
      outcome: { state: 'check-failed', error: 'the licence server reported a licence but returned nothing to write' },
    }
  }

  const write = await transport.writeLicense(Uint8Array.from(activation.license))

  if (write.unsupported) {
    return { deviceId, outcome: { state: 'unsupported' } }
  }
  if (!write.success) {
    return { deviceId, outcome: { state: 'check-failed', error: write.error ?? 'the licence could not be written to the device' } }
  }

  // RE-READ; do not trust the write. 0x49 only STORES bytes: no target checks
  // magic, crc32, `deviceId` or `productId` on write. So `write.success` alone
  // says nothing about what the board now holds, and asserting possession from it
  // means a blob truncated in flight, or signed for another device, reads as
  // "Licensed" while the board runs demo.
  const readBack = await transport.readLicense()
  if (!readBack.success) {
    return {
      deviceId,
      outcome: {
        state: 'check-failed',
        error: `the license was written but could not be confirmed: the read-back failed (${readBack.error ?? 'no reply'})`,
      },
    }
  }

  const verdict = verifyStoredLicenseBlob(
    readBack.status === LIC_STATUS_SUCCESS ? readBack.blob : undefined,
    deviceId,
    packageId,
  )
  if (verdict.ok) return { deviceId, outcome: { state: 'licensed', how: 'activated' } }

  return {
    deviceId,
    outcome: {
      state: 'check-failed',
      error: `the license was written but could not be confirmed on the device: ${verdict.reason}`,
    },
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
