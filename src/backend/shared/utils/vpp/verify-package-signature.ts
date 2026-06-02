/**
 * VPP package signature verification.
 *
 * Counterpart to the signing side in the openplc-packages repo
 * (`scripts/lib/package-signing.ts`). The two MUST agree byte-for-byte on:
 *
 *   1. File enumeration — every regular file under the extracted package,
 *      path relative to the root with POSIX separators ('/'), EXCLUDING the
 *      top-level `signature.json`.
 *   2. File hashing — sha256 of the raw bytes, lower-case hex.
 *   3. Canonicalization — recursive, key-sorted JSON with no extra
 *      whitespace. This is the exact byte string Ed25519 signs/verifies.
 *
 * Verification fails closed: a missing/garbled signature, an unknown key, a
 * bad signature, or ANY file mismatch (extra, missing, or altered) rejects
 * the package. This runs at the import trust boundary before the package's
 * fields are used as paths or its HAL/plugin code is ever compiled.
 */

import { createHash, verify as cryptoVerify } from 'node:crypto'
import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

export const SIGNATURE_FILENAME = 'signature.json'

/** keyId -> PEM-encoded Ed25519 public key. */
export type TrustedKeys = Record<string, string>

export interface SignatureVerification {
  valid: boolean
  error?: string
}

interface SignaturePayload {
  formatVersion: string
  alg: string
  keyId: string
  packageId: string
  version: string
  signedAt: string
  files: Record<string, string>
}

/**
 * Recursive, key-sorted JSON serialization — must match the signing side
 * exactly. Object keys are emitted in lexicographic order at every depth;
 * arrays keep their order.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalize(v)).join(',')}]`
  }
  const record = value as Record<string, unknown>
  const entries = Object.keys(record)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalize(record[k])}`)
  return `{${entries.join(',')}}`
}

/** Collect every regular file under `dir`, as POSIX paths relative to `dir`. */
function listPackageFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry)
      // We're walking UNTRUSTED extracted content. lstatSync does NOT follow
      // symlinks, so a symlink can't make the walk recurse outside `dir` (or
      // loop forever) nor make `readFileSync` later hash its target. Reject
      // anything that isn't a real directory or a regular file.
      const stat = lstatSync(full)
      if (stat.isDirectory()) {
        walk(full)
      } else if (stat.isFile()) {
        out.push(relative(dir, full).split(sep).join('/'))
      } else {
        throw new Error(`Unsupported package entry (not a regular file): ${relative(dir, full).split(sep).join('/')}`)
      }
    }
  }
  walk(dir)
  return out
}

function sha256File(path: string): string {
  return createHash('sha256')
    .update(Uint8Array.from(readFileSync(path)))
    .digest('hex')
}

/** Narrow unknown JSON into a SignaturePayload + detached signature string. */
function parseSignatureFile(raw: unknown): { payload: SignaturePayload; signature: string } | null {
  if (raw === null || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const { signature, ...rest } = obj
  if (typeof signature !== 'string' || signature.length === 0) return null
  if (
    typeof rest.formatVersion !== 'string' ||
    typeof rest.alg !== 'string' ||
    typeof rest.keyId !== 'string' ||
    typeof rest.packageId !== 'string' ||
    typeof rest.version !== 'string' ||
    typeof rest.signedAt !== 'string' ||
    rest.files === null ||
    typeof rest.files !== 'object' ||
    Array.isArray(rest.files)
  ) {
    return null
  }
  const files = rest.files as Record<string, unknown>
  for (const hash of Object.values(files)) {
    if (typeof hash !== 'string') return null
  }
  return { payload: rest as unknown as SignaturePayload, signature }
}

/**
 * Verify the Ed25519 signature embedded in `<extractedDir>/signature.json`
 * against the bytes of every file in the package.
 */
export function verifyPackageSignature(extractedDir: string, trustedKeys: TrustedKeys): SignatureVerification {
  const sigPath = join(extractedDir, SIGNATURE_FILENAME)

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(sigPath, 'utf-8'))
  } catch {
    return { valid: false, error: 'Package is not signed (missing or unreadable signature.json)' }
  }

  const sig = parseSignatureFile(parsed)
  if (!sig) {
    return { valid: false, error: 'signature.json is malformed' }
  }
  const { payload, signature } = sig

  if (payload.alg !== 'ed25519') {
    return { valid: false, error: `Unsupported signature algorithm: ${payload.alg}` }
  }

  const publicKeyPem = trustedKeys[payload.keyId]
  if (!publicKeyPem) {
    return { valid: false, error: `Untrusted signing key: ${payload.keyId}` }
  }

  // 1) Verify the detached signature over the canonical payload. crypto.verify
  // can throw on a malformed key/signature — treat any throw as invalid.
  let signatureOk: boolean
  try {
    signatureOk = cryptoVerify(
      null,
      Uint8Array.from(Buffer.from(canonicalize(payload), 'utf-8')),
      publicKeyPem,
      Uint8Array.from(Buffer.from(signature, 'base64')),
    )
  } catch {
    return { valid: false, error: 'Signature verification error' }
  }
  if (!signatureOk) {
    return { valid: false, error: 'Invalid package signature' }
  }

  // 2) The signature only proves the `files` map is authentic. Now prove the
  // package on disk IS that map: every listed file must exist with the signed
  // hash, and no unlisted file may be present (catches injected files).
  let actualFiles: string[]
  try {
    actualFiles = listPackageFiles(extractedDir).filter((f) => f !== SIGNATURE_FILENAME)
  } catch {
    return { valid: false, error: 'Failed to read package contents' }
  }

  const signedPaths = Object.keys(payload.files)
  if (actualFiles.length !== signedPaths.length) {
    return { valid: false, error: 'Package contents do not match signature (file count mismatch)' }
  }

  for (const rel of actualFiles) {
    const expected = payload.files[rel]
    if (expected === undefined) {
      return { valid: false, error: `Unsigned file present in package: ${rel}` }
    }
    let actual: string
    try {
      actual = sha256File(join(extractedDir, rel))
    } catch {
      return { valid: false, error: `Failed to hash package file: ${rel}` }
    }
    if (actual !== expected) {
      return { valid: false, error: `Tampered file detected: ${rel}` }
    }
  }

  return { valid: true }
}
