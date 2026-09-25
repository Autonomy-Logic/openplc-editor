/**
 * Generic type names, and how they cross the PLCopen XML boundary.
 *
 * PLCopen TC6 v2.01 puts these in the `elementaryTypes` group, so `<ANY/>` and
 * `<ANY_INT/>` are element tags of their own, not `<derived name="ANY"/>`.
 *
 * The editor models them as `user-data-type`, not `base-type`: `base-type`
 * values are validated against `baseTypeSchema`, the elementary registry, and a
 * generic has no width, no wire format and nothing to debug.
 */

/**
 * The ten names PLCopen TC6 v2.01 defines, in schema order.
 *
 * Three more than a POU may be declared with: `ANY_DERIVED`, `ANY_ELEMENTARY`
 * and `ANY_MAGNITUDE` classify types without being declarable. They still round
 * trip, and the compiler is what refuses them, naming the type.
 */
const PLCOPEN_GENERIC_TYPES = [
  'ANY',
  'ANY_DERIVED',
  'ANY_ELEMENTARY',
  'ANY_MAGNITUDE',
  'ANY_NUM',
  'ANY_REAL',
  'ANY_INT',
  'ANY_BIT',
  'ANY_STRING',
  'ANY_DATE',
] as const

const GENERIC_TYPE_SET: ReadonlySet<string> = new Set(PLCOPEN_GENERIC_TYPES)

/** Whether a type name is one of the PLCopen generic types. Case-insensitive. */
const isGenericType = (typeName: string): boolean => GENERIC_TYPE_SET.has(typeName.trim().toUpperCase())

/**
 * The canonical spelling of a generic type name, or `null` if it is not one.
 * PLCopen writes these upper-case, so the tag and the name are the same text.
 */
const canonicalGenericType = (typeName: string): string | null => {
  const upper = typeName.trim().toUpperCase()
  return GENERIC_TYPE_SET.has(upper) ? upper : null
}

export { canonicalGenericType, isGenericType, PLCOPEN_GENERIC_TYPES }
