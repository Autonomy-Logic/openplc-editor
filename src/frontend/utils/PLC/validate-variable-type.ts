import { ZodLiteral } from 'zod'

import { baseTypeSchema, genericTypeSchema } from '../../../middleware/shared/ports/plc-schemas'

type GenericShapeKey = keyof typeof genericTypeSchema.shape

/**
 * Flatten an `ANY_*` generic name down to the set of concrete IEC base
 * type strings it accepts.  Recursive because several generics nest:
 *
 *   ANY_ELEMENTARY → [ANY_MAGNITUDE, ANY_BIT, ANY_CHARS, ANY_DATE]
 *   ANY_MAGNITUDE  → [ANY_REAL, ANY_INT, TIME]
 *   ANY_INTEGRAL   → [ANY_INT, ANY_BIT]
 *   ANY_NUM        → [ANY_INT, ANY_REAL]
 *   ANY_CHARS      → [ANY_CHAR, array<ANY_STRING>]
 *
 * The leaf generics (`ANY_INT`, `ANY_BIT`, `ANY_REAL`, …) are
 * `z.enum`-based and their `.options` are plain strings.  The composite
 * generics use `z.union(z.literal(...))` whose `.options` are
 * `ZodLiteral` instances pointing back into the schema.  Walk the
 * graph, accumulate strings on the way down.
 *
 * Unknown names return `[]`.  Cycles are guarded by a visited set —
 * the schema doesn't currently have cycles, but the guard keeps a
 * misedit in `plc-schemas.ts` from looping forever.
 */
function flattenGenericToBaseTypes(genericName: string, visited: Set<string> = new Set()): string[] {
  const key = genericName.toUpperCase()
  if (visited.has(key)) return []
  visited.add(key)

  const shape = genericTypeSchema.shape[key as GenericShapeKey] as { options?: unknown[] } | undefined
  if (!shape?.options) return []

  const out: string[] = []
  for (const opt of shape.options) {
    if (typeof opt === 'string') {
      out.push(opt.toUpperCase())
      continue
    }
    if (opt instanceof ZodLiteral && typeof opt.value === 'string') {
      const literal = opt.value
      if (literal.startsWith('ANY_')) {
        // Composite generic — recurse.
        for (const sub of flattenGenericToBaseTypes(literal, visited)) out.push(sub)
      } else {
        // Plain base-type name embedded as a literal
        // (e.g. ANY_MAGNITUDE includes z.literal('TIME')).
        out.push(literal.toUpperCase())
      }
      continue
    }
    // ANY_CHARS has `z.array(z.literal('ANY_STRING'))`; the array
    // form is semantically separate (it's "an array of strings", not
    // "a string"), so we skip it here.  No current call site treats
    // STRING and STRING[] as interchangeable.
  }
  return out
}

/**
 * An address produced by `ADR()` is pointer-width and is represented as
 * `ULINT` (this mirrors CODESYS's `__XWORD` on a 64-bit target).  A
 * `POINTER TO <T>` variable holds exactly such an address, so the two are
 * interchangeable at a block pin — independently of `<T>`:
 *
 *   - `ADR`'s `OUT : ULINT` must accept a `POINTER TO INT` sink variable.
 *   - a `POINTER TO <T>` pin must accept a `ULINT` address source.
 *
 * Checked in both directions so the rule fixes every pointer-using block,
 * not just `ADR`.
 */
const POINTER_PREFIX = 'POINTER TO '
const isAddressPointerPair = (a: string, b: string): boolean => {
  const isPointer = (t: string) => t.startsWith(POINTER_PREFIX)
  const isAddressWord = (t: string) => t === 'ULINT'
  return (isPointer(a) && isAddressWord(b)) || (isAddressWord(a) && isPointer(b))
}

export const validateVariableType = (
  selectedType: string,
  expectedType: string,
): { isValid: boolean; error?: string } => {
  const upperSelectedType = selectedType.toUpperCase()
  const upperExpectedType = expectedType.toUpperCase()

  if (upperExpectedType === 'ANY') {
    return {
      isValid: true,
      error: undefined,
    }
  }

  // A POINTER TO <T> variable and a ULINT address word are interchangeable
  // at a block pin (e.g. connecting POINTER TO INT to ADR's ULINT OUT pin).
  if (isAddressPointerPair(upperSelectedType, upperExpectedType)) {
    return {
      isValid: true,
      error: undefined,
    }
  }

  // Handle generic types
  if (upperExpectedType.includes('ANY_')) {
    const validTypes = flattenGenericToBaseTypes(upperExpectedType)
    return {
      isValid: validTypes.includes(upperSelectedType),
      error: validTypes.includes(upperSelectedType) ? undefined : `Expected one of: ${validTypes.join(', ')}`,
    }
  }

  // Handle specific types
  return {
    isValid: upperSelectedType === upperExpectedType,
    error:
      upperSelectedType === upperExpectedType ? undefined : `Expected: ${upperExpectedType}, Got: ${upperSelectedType}`,
  }
}

export const getVariableRestrictionType = (variableType: string) => {
  if (variableType === 'ANY') {
    return {
      values: undefined,
      definition: undefined,
    }
  }

  if (variableType.includes('ANY_')) {
    const flattened = flattenGenericToBaseTypes(variableType)
    // Preserve the legacy single-value shape so existing callers that
    // distinguish singleton generics (e.g. ANY_STRING) keep their
    // current contract — the original code returned `string` rather
    // than `string[]` for single-option generics.  We mirror that here
    // but only when the flattened set is literally one entry.
    if (flattened.length === 1) {
      return {
        values: flattened,
        definition: 'base-type',
      }
    }
    return {
      values: flattened,
      definition: 'base-type',
    }
  }

  const isABaseType = baseTypeSchema.safeParse(variableType.toUpperCase())

  return {
    values: isABaseType.success ? variableType.toUpperCase() : variableType,
    definition: isABaseType.success ? 'base-type' : 'derived',
  }
}
