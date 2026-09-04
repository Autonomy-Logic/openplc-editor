/**
 * Address-space helpers: convert between an `AddressClass`, its IEC prefix
 * string, and a linear slot index. Each prefix is an independent linear
 * space (no byte/word overlap — see types.ts).
 */

import type { AddressClass, IecDirection, IecSize } from './types'

/** IEC prefix for a class, e.g. `{ I, X } → "%IX"`, `{ Q, W } → "%QW"`. */
export function prefixOf(cls: AddressClass): string {
  return `%${cls.direction}${cls.size}`
}

/** Bit-addressed classes (`%IX` / `%QX` / `%MX`) use `byte.bit` notation. */
export function isBitClass(cls: AddressClass): boolean {
  return cls.size === 'X'
}

/** Format a linear slot index back into an IEC address for a class.
 *  Bit classes render as `byte.bit`; all others as a flat index. */
export function formatAddress(cls: AddressClass, linear: number): string {
  const prefix = prefixOf(cls)
  if (isBitClass(cls)) return `${prefix}${Math.floor(linear / 8)}.${linear % 8}`
  return `${prefix}${linear}`
}

const BIT_RE = /^%([IQM])X(\d+)\.(\d+)$/
const WORD_RE = /^%([IQM])([BWDL])(\d+)$/

export interface ParsedAddress {
  cls: AddressClass
  /** Linear slot index within the prefix space (`byte*8 + bit` for bits). */
  linear: number
}

/** Parse a literal IEC address into its class + linear index, or `null`
 *  when the string is not a recognised address. */
export function parseAddress(address: string): ParsedAddress | null {
  const bit = BIT_RE.exec(address)
  if (bit) {
    return {
      cls: { direction: bit[1] as IecDirection, size: 'X' },
      linear: Number(bit[2]) * 8 + Number(bit[3]),
    }
  }
  const word = WORD_RE.exec(address)
  if (word) {
    return {
      cls: { direction: word[1] as IecDirection, size: word[2] as IecSize },
      linear: Number(word[3]),
    }
  }
  return null
}

/** True when the string is a syntactically valid IEC address. */
export function isIecAddress(value: string): boolean {
  return parseAddress(value) !== null
}

/**
 * Do two located declarations touch the same storage?
 *
 * A scalar occupies one slot; an ARRAY occupies one PER ELEMENT, laid out
 * consecutively from its declared address. So `%QX0.0` holding an
 * `ARRAY [0..9] OF BOOL` runs through `%QX1.1`, and a plain `BOOL` at
 * `%QX0.6` lands inside it — a collision the compiler rejects, even though
 * the two address strings differ (openplc-editor#565).
 *
 * Only ranges in the SAME class collide. Each prefix is its own linear space:
 * `%MW0` and `%MD0` name unrelated storage (different runtime arrays), so
 * they never overlap regardless of index.
 *
 * `slots` below 1 is read as 1 — a declaration always occupies at least the
 * address it names, and an unreadable array shape must not silently claim
 * nothing.
 */
export function slotRangesOverlap(a: ParsedAddress, aSlots: number, b: ParsedAddress, bSlots: number): boolean {
  if (a.cls.direction !== b.cls.direction || a.cls.size !== b.cls.size) return false
  const aEnd = a.linear + Math.max(1, aSlots) - 1
  const bEnd = b.linear + Math.max(1, bSlots) - 1
  return a.linear <= bEnd && b.linear <= aEnd
}
