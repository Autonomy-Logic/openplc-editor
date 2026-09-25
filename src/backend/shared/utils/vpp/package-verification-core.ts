/**
 * Platform-free core of VPP package verification.
 *
 * The desktop verifies an extracted directory with `node:crypto`; the browser
 * verifies a `.vpp` still in memory with WebCrypto and JSZip. Everything that
 * MUST agree between them — and with the signer in openplc-packages — lives
 * here: the canonical byte string that is signed, the shape of `signature.json`,
 * the file-set comparison, and the manifest identity check. Only the two
 * primitives that cannot be shared (hash bytes, verify a signature) are
 * injected, so a platform can differ in how it computes sha256 but never in
 * what it decides.
 *
 * Fail-closed throughout: a missing or garbled signature, an unknown key, a bad
 * signature, or ANY file mismatch (extra, missing, altered) rejects the package.
 */

/**
 * Bounds on a `.vpp`, shared by every consumer that opens one. The archive is
 * attacker-controlled until its signature verifies, so extraction is capped
 * before any byte is trusted. autonomy-node and autonomy-edge carry the same
 * numbers in their own constants files (they cannot import this file); the
 * values are provisional pending acceptance (VPP_CONTRACTS §13).
 */
export const VPP_ARCHIVE_LIMITS = {
  maxArchiveBytes: 50 * 1024 * 1024,
  maxExtractedBytes: 200 * 1024 * 1024,
  maxEntryCount: 5000,
  maxEntryBytes: 50 * 1024 * 1024,
  maxPathLength: 512,
} as const

export const SIGNATURE_FILENAME = 'signature.json'
export const MANIFEST_FILENAME = 'manifest.json'

/** keyId -> PEM-encoded Ed25519 public key. */
export type TrustedKeys = Record<string, string>

export interface SignatureVerification {
  valid: boolean
  error?: string
}

export interface SignaturePayload {
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

/** Narrow unknown JSON into a SignaturePayload + detached signature string. */
export function parseSignatureFile(raw: unknown): { payload: SignaturePayload; signature: string } | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
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
 * `"sha256:" + sha256(canonical(payload))` — the package identity used for
 * pinning and drift warnings, derivable without the archive bytes.
 */
export function contentHashOfPayload(payload: SignaturePayload, sha256Hex: (data: Uint8Array) => string): string {
  return `sha256:${sha256Hex(encodeUtf8(canonicalize(payload)))}`
}

export function encodeUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/** Decode base64 without assuming Node's Buffer is present. */
export function decodeBase64(value: string): Uint8Array {
  if (typeof atob === 'function') {
    const binary = atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return bytes
  }
  // Node without a DOM shim.
  return Uint8Array.from(Buffer.from(value, 'base64'))
}

/**
 * The signature half of verification, minus the cryptographic primitive:
 * parse, check the algorithm, and resolve the key id against the trusted set.
 *
 * Deliberately NOT async and NOT taking a verify callback. The desktop's
 * primitive is synchronous and the browser's is not, and a shared function
 * that accommodated both would have to be async — which the desktop cannot
 * await at its call sites. Returning the material instead lets each platform
 * run its own primitive and hand the payload back for `verifyFileSet`.
 */
export function resolveSignatureMaterial(
  signatureJson: unknown,
  trustedKeys: TrustedKeys,
):
  | { payload: SignaturePayload; publicKeyPem: string; signature: Uint8Array; signedBytes: Uint8Array }
  | SignatureVerification {
  const parsed = parseSignatureFile(signatureJson)
  if (!parsed) {
    return { valid: false, error: 'signature.json is malformed' }
  }
  const { payload, signature } = parsed

  if (payload.alg !== 'ed25519') {
    return { valid: false, error: `Unsupported signature algorithm: ${payload.alg}` }
  }

  // Own-property lookup: a keyId of `constructor` or `toString` must not
  // resolve to something off Object.prototype and be treated as a key.
  const publicKeyPem = Object.prototype.hasOwnProperty.call(trustedKeys, payload.keyId)
    ? trustedKeys[payload.keyId]
    : undefined
  if (!publicKeyPem) {
    return { valid: false, error: `Untrusted signing key: ${payload.keyId}` }
  }

  let decodedSignature: Uint8Array
  try {
    decodedSignature = decodeBase64(signature)
  } catch {
    return { valid: false, error: 'signature.json is malformed' }
  }

  return {
    payload,
    publicKeyPem,
    signature: decodedSignature,
    signedBytes: encodeUtf8(canonicalize(payload)),
  }
}

/**
 * The contents half: the signature only proves the `files` map is authentic,
 * so the package on hand must BE that map. Same count, every listed path
 * present with the signed hash, and no unlisted file — an injected file would
 * otherwise ride into the deploy bundle unsigned.
 *
 * `actualHashes` excludes `signature.json`, which signs everything but itself.
 */
export function verifyFileSet(payload: SignaturePayload, actualHashes: Map<string, string>): SignatureVerification {
  const signedPaths = Object.keys(payload.files)
  if (actualHashes.size !== signedPaths.length) {
    return { valid: false, error: 'Package contents do not match signature (file count mismatch)' }
  }

  for (const [rel, actual] of actualHashes) {
    const expected = Object.prototype.hasOwnProperty.call(payload.files, rel) ? payload.files[rel] : undefined
    if (expected === undefined) {
      return { valid: false, error: `Unsigned file present in package: ${rel}` }
    }
    if (actual !== expected) {
      return { valid: false, error: `Tampered file detected: ${rel}` }
    }
  }

  return { valid: true }
}

/**
 * The signed payload pins the identity, so a package signed as A cannot be
 * presented as B by editing only the manifest.
 */
export function verifyManifestIdentity(payload: SignaturePayload, manifestJson: unknown): SignatureVerification {
  if (manifestJson === null || typeof manifestJson !== 'object' || Array.isArray(manifestJson)) {
    return { valid: false, error: 'manifest.json is malformed' }
  }
  const pkg = (manifestJson as Record<string, unknown>).package
  if (pkg === null || typeof pkg !== 'object' || Array.isArray(pkg)) {
    return { valid: false, error: 'manifest.json is missing its package block' }
  }
  const record = pkg as Record<string, unknown>
  if (record.id !== payload.packageId || record.version !== payload.version) {
    return { valid: false, error: 'signature packageId/version disagrees with manifest' }
  }
  return { valid: true }
}

/**
 * Entry paths are what a consumer joins onto a directory, so the shapes that
 * escape one are refused here rather than at each call site. Shared with the
 * hosts' archive readers.
 */
export function isSafePackageEntryPath(name: string, maxLength = 512): boolean {
  if (name.length === 0 || name.length > maxLength) return false
  if (name.includes('\0') || name.includes('\\')) return false
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) return false
  return !name.split('/').some((segment) => segment === '..' || segment === '.' || segment === '')
}
