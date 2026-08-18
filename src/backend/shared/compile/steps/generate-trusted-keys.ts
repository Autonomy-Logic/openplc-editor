/**
 * Author the `trusted_keys.c` translation unit for a licensable VPP
 * build target.
 *
 * Licensable packages do NOT embed their trusted-key table in the
 * prebuilt licensing artifact (the arduino `.a`, the runtime-v4 `.o`
 * link set). The closed objects reference the table as EXTERN symbols:
 *
 *     extern const uint8_t LIC_TRUSTED_KEYS[][64];
 *     extern const uint8_t LIC_TRUSTED_KEY_COUNT;
 *
 * and the table itself travels as `trusted_keys.json` at the package
 * root — injected per environment when the package is published, so the
 * same prebuilt binary trusts staging keys on staging and production
 * keys in production. This step defines those symbols at project build
 * time from the package's json: the same per-project movement as
 * `defines.h`, applied to the licensing key table.
 *
 * Table layout: index = keyId, so the row for key_id 3 IS
 * `LIC_TRUSTED_KEYS[3]`. keyIds absent from the json become zero-filled
 * rows (reserved) — license-core rejects the all-zero public key, so a
 * gap can never validate a blob. `LIC_TRUSTED_KEY_COUNT` is the table
 * LENGTH (highest keyId + 1), which is what the core's bounds check
 * reads; it is a `uint8_t` in the contract, so the highest usable keyId
 * is 254 (a 255 would need a count of 256).
 *
 * Pure functions: no fs I/O, no globals. The platform adapter reads
 * `trusted_keys.json` (editor: from the installed package directory;
 * web: from its package store once VPPs land there) and decides where
 * the generated unit lands — arduino targets put it in the Baremetal
 * sketch tree (sketch objects are always linked, never archive-pruned),
 * runtime-v4 targets put it in the `vpp_plugin/` link set the device
 * builds the plugin `.so` from. Mirrors the style of
 * `generate-vpp-config.ts`.
 */

/** One entry of the package's `trusted_keys.json` `keys` array. */
export interface TrustedKeyEntry {
  /** Table slot this key occupies (blob `key_id` field). 0–255, unique. */
  keyId: number
  /** Raw uncompressed P-256 public key (x||y, 64 bytes, big-endian, no
   *  0x04 prefix) as 128 hex characters — the exact form uECC_verify()
   *  consumes and the backend's signing-key endpoint publishes. */
  pubKeyRawHex: string
}

export type TrustedKeysParseResult = { ok: true; keys: TrustedKeyEntry[] } | { ok: false; reason: string }

/**
 * The one decision both build paths (arduino sketch tree, runtime-v4
 * plugin link set) act on:
 *
 *   - `not-licensable`: the board's VPP is not sold licensed — generate
 *     nothing, the build carries no licensing symbols to satisfy.
 *   - `generated`: write `content` as `trusted_keys.c` into the link
 *     set. `keyCount` / `tableSize` feed the success log line.
 *   - `packaging-fault`: STOP the build with `message`. A licensable
 *     package whose key table is unusable cannot produce firmware that
 *     links (the prebuilt artifact's extern references stay undefined),
 *     so failing here with a message that names the package beats an
 *     undefined-reference wall from the linker.
 */
export type TrustedKeysArtifact =
  | { kind: 'not-licensable' }
  | { kind: 'generated'; content: string; keyCount: number; tableSize: number }
  | { kind: 'packaging-fault'; message: string }

export interface ResolveTrustedKeysArtifactInput {
  /** The board's resolved `capabilities.isLicensable`. */
  isLicensable: boolean
  /** Package identifier for the fault message (package id when known,
   *  board name otherwise) — the message must name what to reinstall. */
  packageLabel: string
  /** Raw text of the package-root `trusted_keys.json`, or `null` when
   *  the file is absent. The adapter does the read (fs on editor) so
   *  this module stays free of I/O. */
  trustedKeysJson: string | null
}

/** Highest keyId VALUE a single entry may carry (the blob's key_id field is
 *  one byte, so 0–255). Numerically equal to MAX_TABLE_SIZE below by the
 *  coincidence of both deriving from uint8_t, but they bound different
 *  things: this bounds one entry's id, that bounds the table's LENGTH. */
const MAX_KEY_ID = 255
/** Highest table LENGTH (highest keyId + 1) that fits the uint8_t
 *  `LIC_TRUSTED_KEY_COUNT` symbol — which caps the highest USABLE keyId
 *  at 254, one below MAX_KEY_ID. The overflow check below is the only
 *  place the two meet; keep both meanings in mind when touching it. */
const MAX_TABLE_SIZE = 255

/** The table is indexed by keyId, so its length is highest keyId + 1.
 *  Single definition shared by the resolver (which logs it) and the
 *  generator (which emits it), so the logged value and the emitted
 *  `LIC_TRUSTED_KEY_COUNT` can never disagree. */
export function trustedKeysTableSize(keys: TrustedKeyEntry[]): number {
  return Math.max(...keys.map((k) => k.keyId)) + 1
}

/**
 * Resolve what the build should do about trusted keys for one target.
 * Single entry point both platforms' adapters call — the licensable
 * gate, the shape validation and the fault wording live here so the
 * arduino and runtime-v4 paths cannot drift apart.
 */
export function resolveTrustedKeysArtifact(input: ResolveTrustedKeysArtifactInput): TrustedKeysArtifact {
  const { isLicensable, packageLabel, trustedKeysJson } = input

  if (!isLicensable) return { kind: 'not-licensable' }

  if (trustedKeysJson === null) {
    return {
      kind: 'packaging-fault',
      message: describeTrustedKeysPackagingFault(packageLabel, 'trusted_keys.json is missing from the package root'),
    }
  }

  const parsed = parseTrustedKeysJson(trustedKeysJson)
  if (!parsed.ok) {
    return { kind: 'packaging-fault', message: describeTrustedKeysPackagingFault(packageLabel, parsed.reason) }
  }

  return {
    kind: 'generated',
    content: generateTrustedKeysContent(parsed.keys),
    keyCount: parsed.keys.length,
    tableSize: trustedKeysTableSize(parsed.keys),
  }
}

/**
 * Validate the raw `trusted_keys.json` text against the packaging
 * contract: `{ "keys": [{ "keyId": 0-255 unique, "pubKeyRawHex":
 * "<128 hex>" }] }`. Unknown extra fields are tolerated (forward
 * compatibility — a future json may carry key labels); everything the
 * generator consumes is checked strictly, because a malformed value
 * here becomes a key table the device trusts.
 */
export function parseTrustedKeysJson(raw: string): TrustedKeysParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return { ok: false, reason: `trusted_keys.json is not valid JSON (${(error as Error).message})` }
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'trusted_keys.json must be an object with a "keys" array' }
  }
  const keysField = (parsed as Record<string, unknown>)['keys']
  if (!Array.isArray(keysField)) {
    return { ok: false, reason: 'trusted_keys.json must carry a "keys" array' }
  }
  if (keysField.length === 0) {
    return {
      ok: false,
      reason: 'the "keys" array is empty — a licensable package must trust at least one signing key',
    }
  }

  const keys: TrustedKeyEntry[] = []
  const seenKeyIds = new Set<number>()
  for (let i = 0; i < keysField.length; i++) {
    const entry: unknown = keysField[i]
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return { ok: false, reason: `keys[${i}] must be an object with keyId and pubKeyRawHex` }
    }
    const record = entry as Record<string, unknown>
    const keyId = record['keyId']
    if (typeof keyId !== 'number' || !Number.isInteger(keyId) || keyId < 0 || keyId > MAX_KEY_ID) {
      return {
        ok: false,
        reason: `keys[${i}].keyId must be an integer between 0 and ${MAX_KEY_ID} (got ${JSON.stringify(keyId)})`,
      }
    }
    if (seenKeyIds.has(keyId)) {
      return { ok: false, reason: `keyId ${keyId} appears more than once` }
    }
    seenKeyIds.add(keyId)
    const pubKeyRawHex = record['pubKeyRawHex']
    if (typeof pubKeyRawHex !== 'string' || !/^[0-9a-fA-F]{128}$/.test(pubKeyRawHex)) {
      return {
        ok: false,
        reason: `keys[${i}].pubKeyRawHex must be exactly 128 hex characters (raw P-256 x||y public key)`,
      }
    }
    // license-core rejects the all-zero key at run time (it is the
    // reserved-slot marker), so a table row full of zeros is "safe" but
    // silent: the build logs "1 key(s)" and the device rejects every
    // licence with nothing pointing at the table. Refuse it with words.
    if (/^0+$/.test(pubKeyRawHex)) {
      return {
        ok: false,
        reason: `keys[${i}].pubKeyRawHex is all zeros — that is the reserved-slot marker, not a key`,
      }
    }
    keys.push({ keyId, pubKeyRawHex })
  }

  // The table is indexed by keyId, so its length is maxKeyId + 1 — and
  // the count symbol is a uint8_t. keyId 255 would need a count of 256,
  // which truncates to 0 and silently distrusts EVERY key. Refuse it
  // here with words instead.
  const maxKeyId = Math.max(...keys.map((k) => k.keyId))
  if (maxKeyId + 1 > MAX_TABLE_SIZE) {
    return {
      ok: false,
      reason:
        `keyId ${maxKeyId} would make the table ${maxKeyId + 1} entries, but LIC_TRUSTED_KEY_COUNT ` +
        `is a uint8_t — the highest usable keyId is ${MAX_TABLE_SIZE - 1}`,
    }
  }

  return { ok: true, keys }
}

/**
 * Build the contents of `trusted_keys.c` from already-validated
 * entries. Deterministic: rows are ordered by keyId regardless of json
 * order, byte formatting is fixed (8 per line, lowercase), so the same
 * json bytes always produce the same C bytes — important for the
 * runtime-v4 plugin checksum (an unchanged table must not force a
 * device-side rebuild) and for cross-repo byte-diff hygiene.
 */
export function generateTrustedKeysContent(keys: TrustedKeyEntry[]): string {
  const byKeyId = new Map<number, TrustedKeyEntry>()
  for (const key of keys) byKeyId.set(key.keyId, key)
  const tableSize = trustedKeysTableSize(keys)

  const lines: string[] = []
  lines.push('/*')
  lines.push(' * trusted_keys.c - trusted ECDSA P-256 public keys (index = keyId).')
  lines.push(' *')
  lines.push(" * AUTO-GENERATED at project build time from the package's")
  lines.push(' * trusted_keys.json - do not edit by hand.')
  lines.push(' *')
  lines.push(' * The licensable prebuilt artifact references LIC_TRUSTED_KEYS /')
  lines.push(' * LIC_TRUSTED_KEY_COUNT as extern symbols; this translation unit is')
  lines.push(' * the single definition the firmware links. Reserved rows (keyIds')
  lines.push(' * absent from the json) are zero-filled - license-core rejects the')
  lines.push(' * all-zero public key, so a reserved slot can never validate a blob.')
  lines.push(' *')
  lines.push(' * MUST be compiled as C. In C++ a const object at namespace scope')
  lines.push(' * has INTERNAL linkage, so these definitions would go static, the')
  lines.push(" * prebuilt's extern references would stay undefined, and the link")
  lines.push(' * would die with the same error that means "the generator did not')
  lines.push(' * run" - two causes, one message. The guard below turns that into')
  lines.push(' * a compile error with words.')
  lines.push(' */')
  lines.push('')
  lines.push('#ifdef __cplusplus')
  lines.push('#error "trusted_keys.c must be compiled as C: C++ gives namespace-scope const objects internal linkage, leaving LIC_TRUSTED_KEYS/LIC_TRUSTED_KEY_COUNT undefined at link time."')
  lines.push('#endif')
  lines.push('')
  lines.push('#include <stdint.h>')
  lines.push('')
  lines.push('/* key_id -> raw public key (x||y, 64 bytes, big-endian). index = keyId */')
  lines.push('const uint8_t LIC_TRUSTED_KEYS[][64] = {')
  for (let keyId = 0; keyId < tableSize; keyId++) {
    const entry = byKeyId.get(keyId)
    if (!entry) {
      lines.push(`    {   /* key_id ${keyId}: reserved (absent from trusted_keys.json) */`)
      lines.push('        0,')
      lines.push('    },')
      continue
    }
    lines.push(`    {   /* key_id ${keyId} */`)
    const hex = entry.pubKeyRawHex.toLowerCase()
    for (let offset = 0; offset < 128; offset += 16) {
      const row = []
      for (let pair = offset; pair < offset + 16; pair += 2) {
        row.push(`0x${hex.slice(pair, pair + 2)},`)
      }
      lines.push(`        ${row.join(' ')}`)
    }
    lines.push('    },')
  }
  lines.push('};')
  lines.push('')
  lines.push(`const uint8_t LIC_TRUSTED_KEY_COUNT = ${tableSize};`)
  lines.push('')
  return lines.join('\n')
}

/**
 * The one wording every trusted-keys build refusal uses, matching the
 * compiler's existing packaging-fault voice: name the package, say what
 * is wrong, say whose fault it is and what to do about it.
 */
export function describeTrustedKeysPackagingFault(packageLabel: string, reason: string): string {
  return (
    `Package "${packageLabel}" is licensable but its trusted-keys table cannot be built: ${reason}. ` +
    'Every licensed VPP ships a `trusted_keys.json` at its package root (injected when the package is ' +
    'published), and the licensed firmware cannot link without it — so this is a packaging fault: ' +
    'reinstall the package, and report it to the vendor if a reinstall does not fix it.'
  )
}
