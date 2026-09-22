/**
 * VPP package signature verification against an extracted directory.
 *
 * Counterpart to the signing side in the openplc-packages repo
 * (`scripts/lib/package-signing.ts`). Everything the two MUST agree on —
 * canonicalization, the file-set comparison, the manifest identity check —
 * lives in `package-verification-core.ts`. This file drives that core the same
 * way the browser verifier (`verify-vpp-archive.ts`) does — including the
 * manifest identity check — so the desktop and the web app cannot decide
 * differently about the same package; it supplies only what is filesystem-
 * and Node-specific: walking the extracted tree, hashing files, and the
 * Ed25519 primitive.
 *
 * Verification fails closed: a missing/garbled signature, an unknown key, a
 * bad signature, ANY file mismatch (extra, missing, or altered), or a manifest
 * that disagrees with the signed identity rejects the package. This runs at
 * the import trust boundary before the package's fields are used as paths or
 * its HAL/plugin code is ever compiled.
 */

import { createHash, verify as cryptoVerify } from 'node:crypto'
import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import {
  canonicalize,
  isSafePackageEntryPath,
  MANIFEST_FILENAME,
  resolveSignatureMaterial,
  SIGNATURE_FILENAME,
  type SignatureVerification,
  type TrustedKeys,
  verifyFileSet,
  verifyManifestIdentity,
} from './package-verification-core'

export { canonicalize, SIGNATURE_FILENAME }
export type { SignatureVerification, TrustedKeys }

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

/**
 * Verify the Ed25519 signature embedded in `<extractedDir>/signature.json`
 * against the bytes of every file in the package, then confirm
 * `<extractedDir>/manifest.json` names the same package the signature does —
 * without this, a package validly signed as A could ship a manifest claiming
 * to be B.
 *
 * Synchronous by contract: the desktop calls it on the import path and again
 * when a project opens, and both are decision points that must not proceed
 * while the answer is still pending.
 */
export function verifyPackageSignature(extractedDir: string, trustedKeys: TrustedKeys): SignatureVerification {
  const sigPath = join(extractedDir, SIGNATURE_FILENAME)

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(sigPath, 'utf-8'))
  } catch {
    return { valid: false, error: 'Package is not signed (missing or unreadable signature.json)' }
  }

  const material = resolveSignatureMaterial(parsed, trustedKeys)
  if ('valid' in material) return material
  const { payload, publicKeyPem, signature, signedBytes } = material

  // 1) Verify the detached signature over the canonical payload. crypto.verify
  // can throw on a malformed key/signature — treat any throw as invalid.
  let signatureOk: boolean
  try {
    signatureOk = cryptoVerify(null, signedBytes, publicKeyPem, signature)
  } catch {
    return { valid: false, error: 'Signature verification error' }
  }
  if (!signatureOk) {
    return { valid: false, error: 'Invalid package signature' }
  }

  // 2) The signature only proves the `files` map is authentic. Now prove the
  // package on disk IS that map.

  let actualFiles: string[]
  try {
    actualFiles = listPackageFiles(extractedDir).filter((f) => f !== SIGNATURE_FILENAME)
  } catch {
    return { valid: false, error: 'Failed to read package contents' }
  }

  const actualHashes = new Map<string, string>()
  for (const rel of actualFiles) {
    if (!isSafePackageEntryPath(rel)) {
      return { valid: false, error: `Unsafe package entry path: ${rel}` }
    }
    try {
      actualHashes.set(rel, sha256File(join(extractedDir, rel)))
    } catch {
      return { valid: false, error: `Failed to hash package file: ${rel}` }
    }
  }

  const fileSet = verifyFileSet(payload, actualHashes)
  if (!fileSet.valid) return fileSet

  // 3) The file set matching the signature only proves manifest.json's BYTES
  // are what was signed — not that its declared identity is what the caller
  // thinks it imported. Refuse a package signed as A that ships a manifest
  // naming B.
  let manifestJson: unknown
  try {
    manifestJson = JSON.parse(readFileSync(join(extractedDir, MANIFEST_FILENAME), 'utf-8'))
  } catch {
    return { valid: false, error: 'Package has no readable manifest.json' }
  }

  return verifyManifestIdentity(payload, manifestJson)
}
