/**
 * IR-native `gettypeAsText` — mirrors the DOM helper
 * (`plcopen.py:1100` and `src/PLCGenerator/type_text.ts`) but reads
 * the variable's type definition directly off the IR.
 */

import type { TranspileVariable, TranspileVariableType } from '../types'

/**
 * Textual representation of a `TranspileVariable`'s declared type:
 *   - `derived` / `user-data-type` → the referenced name as-is.
 *   - `base-type` → uppercased (`'BOOL'`, `'INT'`, …).  Lowercase
 *     `string`/`wstring` are uppercased into `STRING`/`WSTRING`.
 *   - `array` → `ARRAY [a..b, …] OF basetype`.
 */
export function getTypeAsText(variable: TranspileVariable): string {
  return formatType(variable.type)
}

function formatType(type: TranspileVariableType): string {
  if (type.definition === 'derived' || type.definition === 'user-data-type') {
    return type.value
  }
  if (type.definition === 'base-type') {
    return type.value.toUpperCase()
  }
  // array — explicit guard so editor's stricter narrowing keeps the
  // `data` property in scope.  Web's tsconfig accepted the fall-
  // through; editor's doesn't.
  if (type.definition !== 'array') return ''
  const baseName = typeof type.data.baseType === 'string' ? type.data.baseType : type.data.baseType.value
  const dims = type.data.dimensions.map((d) => d.dimension).join(',')
  return `ARRAY [${dims}] OF ${baseName.toUpperCase()}`
}

/**
 * For `computeValue`'s quote-wrapping check we need the type name
 * users actually wrote in the type field — but for the derived case
 * the DOM helper returned the derived name directly (not "ARRAY […]"
 * even if the derived type happens to be an array).  Mirrors the
 * `interface.ts:resolveDeclaredType` quirk.
 */
export function declaredTypeName(variable: TranspileVariable): string {
  if (variable.type.definition === 'derived' || variable.type.definition === 'user-data-type') {
    return variable.type.value
  }
  return getTypeAsText(variable)
}
