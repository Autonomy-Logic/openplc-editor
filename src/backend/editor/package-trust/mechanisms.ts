import { createHash, createPublicKey, verify } from 'node:crypto'
import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import {
  canonicalize,
  decodeBase64,
  encodeUtf8,
  isSafePackageEntryPath,
  MANIFEST_FILENAME,
  parseSignatureFile,
  SIGNATURE_FILENAME,
  verifyFileSet,
  verifyManifestIdentity,
} from '../../shared/utils/vpp/package-verification-core'
import type { PackageSnapshot, PackageTrustMechanisms } from './types'

/** Every regular file under @p dir as sorted POSIX paths; throws on an entry that is neither a directory nor a regular file. */
function listRegularFiles(dir: string): string[] {
  const files: string[] = []
  const walk = (current: string): void => {
    for (const name of readdirSync(current).sort()) {
      const full = join(current, name)
      const stat = lstatSync(full)
      const rel = relative(dir, full).split(sep).join('/')
      if (stat.isDirectory()) walk(full)
      else if (stat.isFile()) files.push(rel)
      else throw new Error(`Unsupported package entry (not a regular file): ${rel}`)
    }
  }
  walk(dir)
  return files
}

/** Parsed JSON of @p bytes, or null when they are not valid UTF-8 JSON. */
function parseJsonDocument(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    return null
  }
}

/** Reads the package in @p packageDir once: both documents and the sha256 of every file but signature.json. */
function readSnapshot(packageDir: string): PackageSnapshot | { error: string } {
  const fileHashes = new Map<string, string>()
  let signatureDocument: unknown = null
  let manifestDocument: unknown = null
  try {
    for (const rel of listRegularFiles(packageDir)) {
      if (!isSafePackageEntryPath(rel)) return { error: `Unsafe package entry path: ${rel}` }
      const bytes = new Uint8Array(readFileSync(join(packageDir, rel)))
      if (rel === SIGNATURE_FILENAME) {
        signatureDocument = parseJsonDocument(bytes)
        continue
      }
      fileHashes.set(rel, createHash('sha256').update(bytes).digest('hex'))
      if (rel === MANIFEST_FILENAME) manifestDocument = parseJsonDocument(bytes)
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
  return { signatureDocument, manifestDocument, fileHashes }
}

/** Ed25519 verification of @p signature over @p message under the SPKI DER key; false on any failure. */
function verifyEd25519(message: Uint8Array, publicKeySpkiDer: Uint8Array, signature: Uint8Array): boolean {
  try {
    const key = createPublicKey({ key: Buffer.from(publicKeySpkiDer), format: 'der', type: 'spki' })
    if (key.asymmetricKeyType !== 'ed25519') return false
    return verify(null, message, key, signature)
  } catch {
    return false
  }
}

/** The PEM text of an SPKI DER public key, as `KeyObject.export` writes it. */
function spkiDerToPem(der: Uint8Array): string {
  return createPublicKey({ key: Buffer.from(der), format: 'der', type: 'spki' })
    .export({ format: 'pem', type: 'spki' })
    .toString()
}

/** The desktop primitives (filesystem, node:crypto) the generated trust module runs on. */
export const desktopPackageTrustMechanisms: PackageTrustMechanisms = {
  readSnapshot,
  verifyEd25519,
  canonicalize,
  parseSignatureFile,
  encodeUtf8,
  decodeUtf8: (bytes) => new TextDecoder().decode(bytes),
  decodeBase64,
  spkiDerToPem,
  verifyFileSet,
  verifyManifestIdentity,
}
