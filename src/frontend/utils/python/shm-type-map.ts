// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * The shared-memory layout for a Python function block's interface — one table,
 * read by both sides of the boundary.
 *
 * Why this file exists.  The C side (`generateSTCode`) and the Python side
 * (`encodeCharactersFromVariable`) each used to carry their own hand-maintained
 * type table, and they disagreed in three places.  Every disagreement was
 * silent and corrupting, because a field the Python format string omits does
 * not merely go missing: `struct.unpack` reads every *later* field from the
 * wrong offset.
 *
 *   - TIME / DATE / TOD / DT — the C side emitted `int64_t`, the Python side
 *     had no entry, so eight bytes vanished from the format string.
 *   - WSTRING — the C side emitted a byte-oriented STRING field (and copied
 *     UTF-16 into it with a character count for a length), the Python side had
 *     no entry at all.
 *   - User-defined types — the C side emitted a one-byte pad, the Python side
 *     had no entry.
 *
 * The fix is structural rather than three more table rows: a descriptor names
 * the C type, the Python `struct` code and the size, and both emitters read it.
 * A field can no longer be added to one side alone, and `shm-type-map.test.ts`
 * asserts every descriptor's declared size against what `struct.calcsize` would
 * compute for its format, so a future edit that breaks the correspondence fails
 * a test instead of a customer's data.
 *
 * This is the local expression of the project rule: layout facts are stated
 * once.  When the codec generator lands (DOPE-584 P6) these descriptors are
 * what it reads, and eventually what it derives from the compiler's own layout
 * output rather than restating at all.
 */

import type { PLCVariable } from '../../../middleware/shared/ports/types'
import { getArrayBaseTypeValue, isArrayVariable } from '../PLC/array-codegen-helpers'

/**
 * How one interface field crosses the boundary.
 *
 * `size` is the packed byte width — the struct is emitted under
 * `#pragma pack(push, 1)` and decoded with Python's `=` prefix, so neither side
 * inserts padding and the two must agree exactly.
 */
export interface ShmFieldDescriptor {
  /** Raw C type for the packed SHM struct field. */
  cType: string
  /** Python `struct` format for the same field. */
  pyFormat: string
  /** Packed width in bytes. */
  size: number
  /**
   * How Python presents the value.
   *
   *   - `scalar`  — a plain int / float / bool, unpacked as-is.
   *   - `string`  — length-prefixed 8-bit body, decoded as UTF-8.
   *   - `wstring` — length-prefixed UTF-16 body; the length counts code units,
   *     so the byte count is twice it.
   */
  kind: 'scalar' | 'string' | 'wstring'
}

/**
 * Maximum characters carried across the boundary for STRING and WSTRING.
 *
 * Not a limit this code chooses: it is the transport convention the debugger
 * already speaks (`debug-map.json` reports STRING at 127 bytes and WSTRING at
 * 253, both being one length byte plus 126 characters).  Stated once here and
 * read by every emitter, rather than written as a literal in four places as it
 * was before.
 */
export const SHM_STRING_CHARS = 126

/** Signed 8-bit length prefix, matching the `__strlen_t` the C stub emits. */
const LEN_PREFIX_BYTES = 1

/**
 * Scalar base types, keyed by the lowercase IEC type name.
 *
 * The C types are the raw underlying representations rather than the strucpp
 * `IEC_*` aliases: those alias `IECVar<T>` wrappers, which are not trivially
 * copyable, so memcpy'ing them into a packed struct is undefined behaviour that
 * gcc rightly rejects.  The C stub bridges between the wrapper and these raw
 * fields at the boundary.
 */
export const SHM_SCALAR_TYPES: Readonly<Record<string, ShmFieldDescriptor>> = {
  bool: { cType: 'uint8_t', pyFormat: 'B', size: 1, kind: 'scalar' },
  sint: { cType: 'int8_t', pyFormat: 'b', size: 1, kind: 'scalar' },
  int: { cType: 'int16_t', pyFormat: 'h', size: 2, kind: 'scalar' },
  dint: { cType: 'int32_t', pyFormat: 'i', size: 4, kind: 'scalar' },
  lint: { cType: 'int64_t', pyFormat: 'q', size: 8, kind: 'scalar' },
  usint: { cType: 'uint8_t', pyFormat: 'B', size: 1, kind: 'scalar' },
  uint: { cType: 'uint16_t', pyFormat: 'H', size: 2, kind: 'scalar' },
  udint: { cType: 'uint32_t', pyFormat: 'I', size: 4, kind: 'scalar' },
  ulint: { cType: 'uint64_t', pyFormat: 'Q', size: 8, kind: 'scalar' },
  byte: { cType: 'uint8_t', pyFormat: 'B', size: 1, kind: 'scalar' },
  word: { cType: 'uint16_t', pyFormat: 'H', size: 2, kind: 'scalar' },
  dword: { cType: 'uint32_t', pyFormat: 'I', size: 4, kind: 'scalar' },
  lword: { cType: 'uint64_t', pyFormat: 'Q', size: 8, kind: 'scalar' },
  real: { cType: 'float', pyFormat: 'f', size: 4, kind: 'scalar' },
  lreal: { cType: 'double', pyFormat: 'd', size: 8, kind: 'scalar' },

  // Duration and calendar types are 64-bit counts on the strucpp side — TIME is
  // nanoseconds (`T#1s` lowers to `1000000000LL`).  Python receives the raw
  // integer, which is what the compiler stores; presenting it as a `timedelta`
  // would be a second representation of the same fact and is deliberately not
  // done here.
  time: { cType: 'int64_t', pyFormat: 'q', size: 8, kind: 'scalar' },
  date: { cType: 'int64_t', pyFormat: 'q', size: 8, kind: 'scalar' },
  tod: { cType: 'int64_t', pyFormat: 'q', size: 8, kind: 'scalar' },
  dt: { cType: 'int64_t', pyFormat: 'q', size: 8, kind: 'scalar' },
}

/**
 * STRING — one length byte plus a 126-byte UTF-8 body.  127 bytes packed,
 * matching what the debug map reports for the same variable.
 */
export const SHM_STRING: ShmFieldDescriptor = {
  cType: 'shm_iec_string_t',
  pyFormat: `b${SHM_STRING_CHARS}s`,
  size: LEN_PREFIX_BYTES + SHM_STRING_CHARS,
  kind: 'string',
}

/**
 * WSTRING — one length byte plus 126 UTF-16 code units.  253 bytes packed,
 * again matching the debug map.
 *
 * This previously shared STRING's descriptor, which was wrong in both
 * directions: the C stub copied `STR_MAX_LEN` *bytes* out of a `char16_t`
 * buffer (63 characters, not 126) while writing a length counted in
 * characters, and read back by reinterpreting a `char16_t` body as `char*`.
 * A distinct layout is what makes the two sides describable at all.
 */
export const SHM_WSTRING: ShmFieldDescriptor = {
  cType: 'shm_iec_wstring_t',
  pyFormat: `b${SHM_STRING_CHARS * 2}s`,
  size: LEN_PREFIX_BYTES + SHM_STRING_CHARS * 2,
  kind: 'wstring',
}

/** Lowercased base-type name of a variable, or `null` when it has none. */
function baseTypeName(variable: PLCVariable): string | null {
  if (isArrayVariable(variable)) {
    const inner = getArrayBaseTypeValue(variable)
    return inner ? inner.toLowerCase() : null
  }
  if (variable.type.definition !== 'base-type') return null
  return variable.type.value.toLowerCase()
}

/**
 * Descriptor for the element type of `variable`, or `null` when the type cannot
 * cross the boundary today.
 *
 * `null` is a refusal, not a silent skip: callers surface it to the user.  That
 * is the whole point — a type the emitters cannot agree on must stop the build
 * rather than quietly shift every field after it.  Structures, enumerations and
 * function block instances land in later phases and will return descriptors
 * then.
 */
export function describeShmField(variable: PLCVariable): ShmFieldDescriptor | null {
  const name = baseTypeName(variable)
  if (!name) return null
  if (name === 'string') return SHM_STRING
  if (name === 'wstring') return SHM_WSTRING
  return SHM_SCALAR_TYPES[name] ?? null
}

/**
 * Human-readable type for an error message — the array form included, so a
 * refusal names what the user actually declared.
 */
export function describeVariableType(variable: PLCVariable): string {
  if (isArrayVariable(variable)) {
    const inner = getArrayBaseTypeValue(variable)
    return `ARRAY OF ${(inner || 'unknown').toUpperCase()}`
  }
  return variable.type.value.toUpperCase()
}
