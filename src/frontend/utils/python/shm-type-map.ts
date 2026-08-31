// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * The shared-memory layout for a Python function block's interface — one table,
 * read by both sides of the boundary.
 *
 * Why this file exists.  The C side (`generateSTCode`) and the Python side each
 * used to carry their own hand-maintained type table, and they disagreed in
 * three places.  Every disagreement was
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
import { IEC_BASE_TYPES, type IECWireFormat, lookupBaseType } from '../iec-types-registry'
import { getArrayBaseTypeValue, isArrayVariable } from '../PLC/array-codegen-helpers'
import { DEBUG_STRING_CAP } from '../variable-sizes'

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
export const SHM_STRING_CHARS = DEBUG_STRING_CAP

/** Signed 8-bit length prefix, matching the `__strlen_t` the C stub emits. */
const LEN_PREFIX_BYTES = 1

/**
 * The one fact this file owns: how a wire format is spelled on each side of the
 * boundary.
 *
 * Everything else about an elementary type — that it exists, what it is called,
 * what it is aliased to, how wide it is — comes from strucpp's
 * `libs/iec-types.json` through {@link IEC_BASE_TYPES}. This table maps only
 * `wireFormat` to the raw C spelling and the Python `struct` code, which is
 * genuinely local knowledge: the registry's `cppType` is the strucpp `IEC_*`
 * wrapper (`INT_t` aliases `IECVar<int16_t>`), and a wrapper is not trivially
 * copyable, so it cannot be a member of a packed struct that gets memcpy'd.
 * The C stub bridges the wrapper to these raw fields at the boundary.
 *
 * `null` marks a format that needs a layout rather than a single field —
 * STRING and WSTRING, whose length prefix plus body is described by
 * {@link SHM_STRING} / {@link SHM_WSTRING} below.
 *
 * Exhaustive over `IECWireFormat` by type, so a new wire format in a future
 * strucpp release fails to compile here instead of silently dropping a type.
 */
const WIRE_FORMAT_FIELDS: Readonly<Record<IECWireFormat, Pick<ShmFieldDescriptor, 'cType' | 'pyFormat'> | null>> = {
  bool: { cType: 'uint8_t', pyFormat: 'B' },
  int8: { cType: 'int8_t', pyFormat: 'b' },
  uint8: { cType: 'uint8_t', pyFormat: 'B' },
  int16: { cType: 'int16_t', pyFormat: 'h' },
  uint16: { cType: 'uint16_t', pyFormat: 'H' },
  int32: { cType: 'int32_t', pyFormat: 'i' },
  uint32: { cType: 'uint32_t', pyFormat: 'I' },
  int64: { cType: 'int64_t', pyFormat: 'q' },
  uint64: { cType: 'uint64_t', pyFormat: 'Q' },
  float32: { cType: 'float', pyFormat: 'f' },
  float64: { cType: 'double', pyFormat: 'd' },
  // Duration and calendar types are 64-bit counts on the strucpp side — TIME is
  // nanoseconds (`T#1s` lowers to `1000000000LL`), DATE is days. Python receives
  // the raw integer, which is what the compiler stores; presenting it as a
  // `timedelta` would be a second representation of the same fact and is
  // deliberately not done here.
  'duration-ns-i64': { cType: 'int64_t', pyFormat: 'q' },
  'datetime-ns-i64': { cType: 'int64_t', pyFormat: 'q' },
  'date-ns-i64': { cType: 'int64_t', pyFormat: 'q' },
  'tod-ns-i64': { cType: 'int64_t', pyFormat: 'q' },
  'len8-utf8': null,
  'len8-utf16le': null,
}

/**
 * Scalar base types, keyed by the lowercase IEC type name AND by every alias
 * the registry declares, so `TIME_OF_DAY` resolves exactly like `TOD`.
 *
 * Derived, not written: the byte width is the registry's `byteSize`, so a size
 * cannot drift from what the compiler emits. Names beginning with `__` are
 * strucpp internals (`__XWORD`) and are not user-declarable, so they are
 * skipped.
 */
export const SHM_SCALAR_TYPES: Readonly<Record<string, ShmFieldDescriptor>> = (() => {
  const table: Record<string, ShmFieldDescriptor> = {}
  for (const type of IEC_BASE_TYPES) {
    if (type.name.startsWith('__')) continue
    const field = WIRE_FORMAT_FIELDS[type.wireFormat]
    if (!field) continue
    const descriptor: ShmFieldDescriptor = { ...field, size: type.byteSize, kind: 'scalar' }
    table[type.name.toLowerCase()] = descriptor
    for (const alias of type.aliases) table[alias.toLowerCase()] = descriptor
  }
  return table
})()

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

/**
 * As-declared base-type name of a variable, or `null` when it has none.
 *
 * Returned verbatim rather than lower-cased: {@link describeShmBaseType}
 * normalises through the registry, which trims and folds case and resolves
 * aliases in one place. Lower-casing here as well would be a second, weaker
 * copy of that rule — it was one, and it is what made a variable spelled
 * `TIME_OF_DAY` refuse while `TOD` was accepted.
 */
function baseTypeName(variable: PLCVariable): string | null {
  if (isArrayVariable(variable)) {
    return getArrayBaseTypeValue(variable) ?? null
  }
  if (variable.type.definition !== 'base-type') return null
  return variable.type.value
}

/**
 * Descriptor for an elementary type named in any spelling the registry accepts
 * — canonical or alias, any case, whitespace-padded — or `null` when the name
 * is not an elementary type at all.
 *
 * Normalising through `lookupBaseType` is what keeps this in step with the rest
 * of the editor: the variables-table dropdown offers canonical names, but
 * PLCopen XML import and library FB manifests both carry aliases, and legacy
 * project files carry padding.
 */
export function describeShmBaseType(typeName: string): ShmFieldDescriptor | null {
  const metadata = lookupBaseType(typeName)
  if (!metadata) return null
  if (metadata.wireFormat === 'len8-utf8') return SHM_STRING
  if (metadata.wireFormat === 'len8-utf16le') return SHM_WSTRING
  return SHM_SCALAR_TYPES[metadata.name.toLowerCase()] ?? null
}

/**
 * Descriptor for the element type of `variable`, or `null` when the type cannot
 * cross the boundary today.
 *
 * `null` is a refusal, not a silent skip: callers surface it to the user.  That
 * is the whole point — a type the emitters cannot agree on must stop the build
 * rather than quietly shift every field after it.
 */
export function describeShmField(variable: PLCVariable): ShmFieldDescriptor | null {
  const name = baseTypeName(variable)
  if (!name) return null
  return describeShmBaseType(name)
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
