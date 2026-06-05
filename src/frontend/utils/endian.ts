/**
 * Endianness handling for the debugger wire format.
 *
 * Contract:
 *
 *   - The OpenPLC runtime (Arduino baremetal, Linux v4) writes and reads
 *     variable bytes via plain `memcpy` — wire format equals the target's
 *     native byte order.  This is intentional: the target stays simple
 *     and code-size-cheap on AVR; the editor (running on a host with
 *     plenty of compute) does the adaptation.
 *
 *   - The editor's internal codecs (`floatToBuffer`, `integerToBuffer`,
 *     `decodeWireValue`, etc.) always produce / consume **little-endian**
 *     bytes.  The swap layer below normalises the wire bytes to that
 *     canonical internal form on reads, and back to target-native on
 *     writes.
 *
 *   - Target byte order is detected once per debug session from the MD5
 *     response trailer: the runtime writes the literal value `0xDEAD`
 *     via a native `uint16_t*` store, so the bytes on the wire reveal
 *     its byte order.  See `MD5_ENDIAN_SENTINEL_*` below for the
 *     expected patterns.
 *
 *   - All helpers in this module operate on `Uint8Array` indices only.
 *     That keeps every code path host-endian-agnostic — Node may run on
 *     any host (LE x86_64 today, BE PowerPC hypothetically) and the
 *     swap behaviour is identical.  Do not use typed-array views (e.g.
 *     `Uint16Array(buf)`) anywhere on wire data; those bind to host
 *     byte order and would silently corrupt cross-platform setups.
 */

/**
 * The two-byte sentinel the runtime emits in the MD5 response trailer.
 * The runtime writes `0xDEAD` through a native `uint16_t*`, so:
 *
 *   - Little-endian target → bytes on the wire are `[0xAD, 0xDE]`.
 *   - Big-endian    target → bytes on the wire are `[0xDE, 0xAD]`.
 */
export const MD5_ENDIAN_SENTINEL_LE: readonly [number, number] = [0xad, 0xde]
export const MD5_ENDIAN_SENTINEL_BE: readonly [number, number] = [0xde, 0xad]

export type TargetEndian = 'le' | 'be'

/**
 * Classify the runtime's MD5 trailer bytes into `'le' | 'be'`.
 *
 * - `[0xAD, 0xDE]` → `'le'` (target wrote `0xDEAD` natively as LE).
 * - `[0xDE, 0xAD]` → `'be'` (target wrote `0xDEAD` natively as BE).
 * - Anything else → `'le'` and a console warning.  The default keeps
 *   the dominant case (every shipped target is LE) functioning even
 *   when the trailer is missing / malformed (e.g. older runtimes that
 *   still echo the probe bytes); the warning surfaces protocol
 *   regressions in development.
 */
export function detectTargetEndian(hi: number, lo: number): TargetEndian {
  if (hi === MD5_ENDIAN_SENTINEL_LE[0] && lo === MD5_ENDIAN_SENTINEL_LE[1]) return 'le'
  if (hi === MD5_ENDIAN_SENTINEL_BE[0] && lo === MD5_ENDIAN_SENTINEL_BE[1]) return 'be'
  console.warn(
    `[endian] unrecognised MD5 endianness sentinel [0x${hi.toString(16)}, 0x${lo.toString(16)}], ` +
      `assuming LE.  Older runtime build?`,
  )
  return 'le'
}

/**
 * Reverse `size` bytes starting at `offset` within `buf`, in place.
 * Byte-level swap that depends on nothing but `Uint8Array` indexing.
 *
 * No-op when `size <= 1`.
 */
export function reverseBytesInPlace(buf: Uint8Array, offset: number, size: number): void {
  if (size <= 1) return
  const last = offset + size - 1
  for (let i = 0; i < size >> 1; i++) {
    const a = offset + i
    const b = last - i
    const t = buf[a]
    buf[a] = buf[b]
    buf[b] = t
  }
}

/**
 * Wire→internal-LE adaptation for a single variable.  Caller supplies
 * the type name (canonical IEC, e.g. `'REAL'`, `'DINT'`, `'STRING'`) so
 * we can skip swapping for byte-array types where byte order is not a
 * concept.
 *
 * STRING / WSTRING storage is a length byte followed by a byte stream —
 * the bytes themselves don't have a multi-byte numeric interpretation,
 * so swapping them would corrupt the data.  This matches the historical
 * MatIEC `swap_bytes` carve-out (it explicitly skipped `STRING_ENUM`).
 *
 * Operates in place.
 */
export function applySwapToVariableBytes(
  buf: Uint8Array,
  offset: number,
  size: number,
  typeName: string,
  targetEndian: TargetEndian,
): void {
  if (targetEndian === 'le') return // editor's internal codec is already LE
  if (!isMultiByteSwapType(typeName)) return
  reverseBytesInPlace(buf, offset, size)
}

/**
 * Whether a type's wire bytes should participate in endianness swapping.
 *
 * Multi-byte numeric / chrono primitives → yes.
 * BOOL is single-byte → no.
 * STRING / WSTRING are byte streams (length prefix + raw bytes) → no.
 */
function isMultiByteSwapType(typeName: string): boolean {
  const upper = typeName.toUpperCase()
  if (upper === 'STRING' || upper === 'WSTRING') return false
  return true
}
