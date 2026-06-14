/**
 * Encodes form-field values into a configuration byte array.
 *
 * VPP module configuration screens declare an `encoding` block per
 * field that describes how the field's value contributes to the raw
 * SPI configuration payload the runtime plugin pushes to each slot
 * (see synergy_spi_send_config). This module converts the {fieldId
 * -> value} bag the editor stores into the byte array the runtime
 * expects.
 *
 * Per-field semantics:
 *
 *   - The value is parsed as a number. Strings prefixed with "0x" or
 *     "0X" are parsed as hex; everything else as decimal. Booleans
 *     become 1/0; missing values are skipped (the byte stays zero).
 *   - When `mask` and `base` are both provided, the bits selected by
 *     `mask` come from the value and the rest come from `base`. This
 *     is how a "low nibble selects type, upper 12 bits identify the
 *     channel" layout (e.g. P1/SLM thermocouple `0x2100 | type`) is
 *     expressed without duplicating the channel constant on every
 *     option.
 *   - When `mask` and `base` are both omitted, the value is written
 *     verbatim. Specifying only one is a screen-author error: we
 *     emit a console warning and treat it as "no mask/base."
 *   - Bytes are written in `endian` order at `byteOffset`. Default
 *     endian is `big`. Field overlap (two fields writing to the same
 *     offset) is permitted; later fields overwrite earlier ones —
 *     screen authors should avoid this.
 *   - Writes that fall outside the configured `totalBytes` are
 *     clipped. The output array is always exactly `totalBytes` long
 *     when that value is provided, otherwise it is sized to the
 *     largest declared (byteOffset + size).
 */

type FieldValue = string | number | boolean | undefined | null

export type ByteEncoding = {
  byteOffset: number
  size: 1 | 2
  endian?: 'big' | 'little'
  mask?: string
  base?: string
}

export type EncoderFieldDef = {
  id: string
  /** May arrive shaped as `ByteEncoding` or as something else
   *  entirely (vendor-supplied JSON). `isEncoding()` narrows it
   *  internally. */
  encoding?: unknown
}

/** Parse a hex (`0x...`) or decimal string into an integer. Returns
 *  null on parse failure or unsupported input. */
function parseNumberLike(v: FieldValue): number | null {
  if (v === undefined || v === null || v === '') return null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v).trim()
  if (s === '') return null
  const isHex = s.startsWith('0x') || s.startsWith('0X')
  const parsed = isHex ? Number.parseInt(s.slice(2), 16) : Number.parseInt(s, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function isEncoding(e: unknown): e is ByteEncoding {
  if (!e || typeof e !== 'object') return false
  const r = e as Record<string, unknown>
  return typeof r.byteOffset === 'number' && (r.size === 1 || r.size === 2)
}

function computeTotalBytes(fields: EncoderFieldDef[], explicit: number | undefined): number {
  if (typeof explicit === 'number' && explicit >= 0) return explicit
  let max = 0
  for (const f of fields) {
    if (!isEncoding(f.encoding)) continue
    const end = f.encoding.byteOffset + f.encoding.size
    if (end > max) max = end
  }
  return max
}

/**
 * Encode field values into a configuration byte array.
 *
 * @param fields    Form-layout fields (with optional `encoding`)
 * @param values    Bag of field-id -> current value, as stored in the
 *                  Zustand vendor-screen state
 * @param totalBytes Optional fixed output size. When supplied, the
 *                  output is zero-padded or clipped to exactly this
 *                  length. When omitted, the output covers exactly
 *                  what the fields declare.
 */
export function encodeConfigBytes(
  fields: EncoderFieldDef[],
  values: Record<string, FieldValue>,
  totalBytes?: number,
): number[] {
  const length = computeTotalBytes(fields, totalBytes)
  const bytes = new Array<number>(length).fill(0)
  if (length === 0) return bytes

  for (const field of fields) {
    if (!isEncoding(field.encoding)) continue
    const enc = field.encoding
    const raw = parseNumberLike(values[field.id])
    if (raw === null) continue

    let composed = raw
    const hasMask = typeof enc.mask === 'string'
    const hasBase = typeof enc.base === 'string'
    if (hasMask !== hasBase) {
      // Inconsistent — treat as no mask/base. Surfaced as a warning
      // because it's almost certainly a screen-author mistake.
      console.warn(
        `[vpp byte-encoder] field "${field.id}" defines only one of mask/base; both are required to merge with the value`,
      )
    } else if (hasMask && hasBase) {
      const mask = parseNumberLike(enc.mask) ?? 0
      const base = parseNumberLike(enc.base) ?? 0
      composed = (base & ~mask) | (raw & mask)
    }

    const endian = enc.endian ?? 'big'
    const size = enc.size

    // Mask to size to avoid leaking high bits the screen author
    // didn't anticipate (e.g. a 32-bit option value into a size-2
    // field).
    const widthMask = size === 1 ? 0xff : 0xffff
    const bounded = composed & widthMask

    if (size === 1) {
      const off = enc.byteOffset
      if (off >= 0 && off < length) bytes[off] = bounded
    } else {
      const hi = (bounded >> 8) & 0xff
      const lo = bounded & 0xff
      const off0 = enc.byteOffset
      const off1 = enc.byteOffset + 1
      if (endian === 'big') {
        if (off0 >= 0 && off0 < length) bytes[off0] = hi
        if (off1 >= 0 && off1 < length) bytes[off1] = lo
      } else {
        if (off0 >= 0 && off0 < length) bytes[off0] = lo
        if (off1 >= 0 && off1 < length) bytes[off1] = hi
      }
    }
  }

  return bytes
}

/** Format bytes as a space-separated hex string, e.g. "40 03 60 05". */
export function bytesToHexString(bytes: number[]): string {
  return bytes.map((b) => (b & 0xff).toString(16).padStart(2, '0').toUpperCase()).join(' ')
}
