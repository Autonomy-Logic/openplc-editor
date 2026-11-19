import type {
  SignaturePayload,
  SignatureVerification,
  TrustedKeys,
} from '../../shared/utils/vpp/package-verification-core'

/** One read of a package directory: its two documents and the hash of every other file. */
export interface PackageSnapshot {
  signatureDocument: unknown
  manifestDocument: unknown
  /** POSIX path -> sha256 hex of every regular file except signature.json. */
  fileHashes: Map<string, string>
}

/** The platform primitives the generated module runs on; it imports nothing at runtime. */
export interface PackageTrustMechanisms {
  /** Reads the package once; an error string when any entry is not a regular file, unsafe or unreadable. */
  readSnapshot(packageDir: string): PackageSnapshot | { error: string }
  /** Ed25519 verify under an SPKI DER key; false, never a throw, on any failure. */
  verifyEd25519(message: Uint8Array, publicKeySpkiDer: Uint8Array, signature: Uint8Array): boolean
  canonicalize(value: unknown): string
  parseSignatureFile(raw: unknown): { payload: SignaturePayload; signature: string } | null
  encodeUtf8(text: string): Uint8Array
  decodeUtf8(bytes: Uint8Array): string
  decodeBase64(value: string): Uint8Array
  spkiDerToPem(der: Uint8Array): string
  verifyFileSet(payload: SignaturePayload, actualHashes: Map<string, string>): SignatureVerification
  verifyManifestIdentity(payload: SignaturePayload, manifestJson: unknown): SignatureVerification
}

/** The two decision hooks of the desktop editor and the key map it hands to the shared verifier. */
export interface PackageTrustAnchor {
  /** A fresh keyId -> PEM map for the shared verifier, rebuilt on every call. */
  trustedKeys(): TrustedKeys
  /** Import hook; null when every site bound to it accepts the package in packageDir, else a refusal reason. */
  checkAtImport(packageDir: string): string | null
  /** Installed-package hook (startup sweep, rejection reason, pre-build gate; GUI and CLI). */
  checkAtUse(packageDir: string): string | null
}

/** The export of a generated trust module. */
export type CreatePackageTrustAnchor = (mechanisms: PackageTrustMechanisms) => PackageTrustAnchor
