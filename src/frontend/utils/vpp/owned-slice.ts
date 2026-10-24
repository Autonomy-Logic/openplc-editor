/**
 * The slice of `vendorScreenData` a vendor-screen tab owns, serialised for
 * `cleanState` and fingerprinted for the dirty compare.
 *
 * `cleanState` keeps the full slice so "Don't save" can restore a configurator
 * archive byte-for-byte. The dirty compare runs on every store change, so it
 * replaces each archive with a hash instead of serialising it every time.
 */

type VendorScreenData = Record<string, unknown> | undefined

function pickOwnedSlice(vendorScreenData: VendorScreenData, ownedKeys: readonly string[]): Record<string, unknown> {
  const slice: Record<string, unknown> = {}
  for (const k of [...ownedKeys].sort()) {
    if (vendorScreenData && Object.prototype.hasOwnProperty.call(vendorScreenData, k)) {
      slice[k] = vendorScreenData[k]
    }
  }
  return slice
}

/** Sorted by key so insertion order does not matter for the compare. */
export function serializeOwnedSlice(vendorScreenData: VendorScreenData, ownedKeys: readonly string[]): string {
  return JSON.stringify(pickOwnedSlice(vendorScreenData, ownedKeys))
}

/** cyrb53: a fast 53-bit string hash, enough to tell two archives apart for a dirty flag. */
function hashString(value: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < value.length; i++) {
    const ch = value.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16)
}

let lastArchive: string | null = null
let lastArchiveHash = ''

function archiveHash(archive: string): string {
  if (archive !== lastArchive) {
    lastArchive = archive
    lastArchiveHash = `${archive.length}:${hashString(archive)}`
  }
  return lastArchiveHash
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function fingerprintSlice(slice: Record<string, unknown>, configuratorKeys: readonly string[]): string {
  for (const key of configuratorKeys) {
    const value = slice[key]
    if (isRecord(value) && typeof value.archive === 'string') {
      slice[key] = { ...value, archive: archiveHash(value.archive) }
    }
  }
  return JSON.stringify(slice)
}

export function ownedSliceFingerprint(
  vendorScreenData: VendorScreenData,
  ownedKeys: readonly string[],
  configuratorKeys: readonly string[],
): string {
  return fingerprintSlice(pickOwnedSlice(vendorScreenData, ownedKeys), configuratorKeys)
}

let lastClean: { cleanState: string; configuratorKeys: string; fingerprint: string } | null = null

/** Fingerprint of a `cleanState` written by `serializeOwnedSlice`; memoised because it is compared on every change. */
export function cleanStateFingerprint(cleanState: string, configuratorKeys: readonly string[]): string {
  const keysSignature = configuratorKeys.join('\n')
  if (lastClean && lastClean.cleanState === cleanState && lastClean.configuratorKeys === keysSignature) {
    return lastClean.fingerprint
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(cleanState)
  } catch {
    return cleanState
  }
  const fingerprint = isRecord(parsed) ? fingerprintSlice(parsed, configuratorKeys) : cleanState
  lastClean = { cleanState, configuratorKeys: keysSignature, fingerprint }
  return fingerprint
}
