import { createHash, createPublicKey } from 'node:crypto'

import { desktopPackageTrustMechanisms } from '../../src/backend/editor/package-trust/mechanisms'
import type {
  CreatePackageTrustAnchor,
  PackageSnapshot,
  PackageTrustMechanisms,
} from '../../src/backend/editor/package-trust/types'

type Hook = 'import' | 'use'

interface RecordedCall {
  hook: Hook
  keyDigest: string
  result: boolean
}

const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

/** keyId -> SHA-256 hex of the SPKI DER of each PEM key in @p keys. */
function expectedDigests(keys: Record<string, string>): Map<string, string> {
  const digests = new Map<string, string>()
  for (const [keyId, pem] of Object.entries(keys)) {
    digests.set(keyId, sha256Hex(Uint8Array.from(createPublicKey(pem).export({ format: 'der', type: 'spki' }))))
  }
  return digests
}

/** A package whose signature names @p keyId and cannot verify under any key. */
function syntheticSnapshot(keyId: string): PackageSnapshot {
  const manifestDocument = { package: { id: 'com.example.fingerprint', version: '1.0.0' } }
  const manifestHash = sha256Hex(new TextEncoder().encode(JSON.stringify(manifestDocument)))
  return {
    signatureDocument: {
      formatVersion: '1.0',
      alg: 'ed25519',
      keyId,
      packageId: 'com.example.fingerprint',
      version: '1.0.0',
      signedAt: '1970-01-01T00:00:00.000Z',
      files: { 'manifest.json': manifestHash },
      signature: Buffer.alloc(64, 1).toString('base64'),
    },
    manifestDocument,
    fileHashes: new Map([['manifest.json', manifestHash]]),
  }
}

function anchorProblems(create: CreatePackageTrustAnchor, keys: Record<string, string>): string[] {
  const expected = expectedDigests(keys)
  const allowed = new Set(expected.values())
  const [keyId] = [...expected.keys()].sort()
  const snapshot = syntheticSnapshot(keyId)
  const calls: RecordedCall[] = []
  let hook: Hook = 'import'
  const mechanisms: PackageTrustMechanisms = {
    ...desktopPackageTrustMechanisms,
    readSnapshot: () => snapshot,
    verifyEd25519: (message, key, signature) => {
      const result = desktopPackageTrustMechanisms.verifyEd25519(message, key, signature)
      calls.push({ hook, keyDigest: sha256Hex(Uint8Array.from(key)), result })
      return result
    },
  }

  const problems: string[] = []
  const anchor = create(mechanisms)
  const map = anchor.trustedKeys()
  const mapIds = Object.keys(map).sort()
  if (mapIds.join('\n') !== [...expected.keys()].sort().join('\n')) {
    problems.push(`the key map holds ${mapIds.length} key id(s) that differ from the ${expected.size} expected`)
  }
  for (const [mapId, pem] of Object.entries(map)) {
    let digest = ''
    try {
      digest = sha256Hex(Uint8Array.from(createPublicKey(pem).export({ format: 'der', type: 'spki' })))
    } catch {
      problems.push('the key map holds a key that is not a public key')
      continue
    }
    if (expected.get(mapId) !== digest) problems.push('a key of the key map differs from the expected key')
  }

  const importVerdict = anchor.checkAtImport('<fingerprint>')
  hook = 'use'
  const verdicts: Record<Hook, string | null> = { import: importVerdict, use: anchor.checkAtUse('<fingerprint>') }

  for (const checked of ['import', 'use'] as const) {
    const failed = calls.filter((call) => call.hook === checked && !call.result)
    if (failed.length < 2) problems.push(`the ${checked} hook made ${failed.length} failing key check(s), fewer than 2`)
    if (failed.some((call) => !allowed.has(call.keyDigest))) {
      problems.push(`the ${checked} hook checked a signature under a key that is not expected`)
    }
    if (verdicts[checked] === null) problems.push(`the ${checked} hook accepted a package with an invalid signature`)
  }
  return problems
}

/**
 * Checks that the trust module @p create recombines exactly the keys in @p keys: the key map it hands out, and every
 * key its sites checked a failing signature under, while both hooks refuse a synthetic package. Never throws.
 */
export function checkFingerprint(
  create: CreatePackageTrustAnchor,
  keys: Record<string, string>,
): { ok: true } | { ok: false; error: string } {
  let problems: string[]
  try {
    problems = anchorProblems(create, keys)
  } catch (error) {
    problems = [`the module failed: ${error instanceof Error ? error.message : String(error)}`]
  }
  return problems.length === 0 ? { ok: true } : { ok: false, error: `fingerprint mismatch: ${problems.join('; ')}` }
}
