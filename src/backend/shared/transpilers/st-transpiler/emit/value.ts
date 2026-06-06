/**
 * IR-native `computeValue` — wraps STRING/WSTRING initial values in
 * quotes when the user didn't already.  Mirrors
 * `ProgramGenerator.ComputeValue` (PLCGenerator.py:135) without going
 * through DOM accessors; the project's data-type alias chain is
 * walked directly off the IR's `dataTypes` array.
 */

import { TypeHierarchy } from '../helpers/type-hierarchy'
import type { TranspileDataType, TranspileProject } from '../types'

/**
 * Walk `typename` down through `project.dataTypes` aliases until an
 * elementary IEC type is reached.  Returns `null` if the chain
 * dead-ends (unknown alias, struct/enum leaves where the elementary
 * base is intentionally absent).
 *
 * Identical behaviour to `pou_assembly.getBaseType`, just reading the
 * IR map instead of the DOM project.
 */
function getBaseType(typename: string, dataTypeIndex: Map<string, TranspileDataType>): string | null {
  // Elementary types short-circuit (the existing DOM helper does the same).
  if (typename in TypeHierarchy) return typename

  const dt = dataTypeIndex.get(typename)
  if (!dt) return null

  if (dt.derivation === 'array') {
    return getBaseType(typeof dt.baseType === 'string' ? dt.baseType : dt.baseType.value, dataTypeIndex)
  }
  if (dt.derivation === 'directly-derived') {
    return getBaseType(dt.baseType, dataTypeIndex)
  }
  // Struct / enum leaves: Python's GetDataTypeBaseType returns the
  // type name itself.  We return the same so STRING/WSTRING quote
  // gating doesn't fire on them.
  return typename
}

/**
 * Resolve a variable's underlying elementary base type from the
 * IR.  Used by initial-value quote wrapping
 * (`'foo'` for STRING, `"foo"` for WSTRING).  Returns `null` when
 * the chain doesn't terminate at an elementary type.
 */
export function resolveBaseType(typename: string, project: TranspileProject): string | null {
  const index = new Map<string, TranspileDataType>()
  for (const dt of project.dataTypes) index.set(dt.name, dt)
  return getBaseType(typename, index)
}

/**
 * Same as the DOM helper at `pou_assembly.computeValue` — wrap
 * STRING / WSTRING initial values in quotes when the source text
 * doesn't already carry them.
 */
export function computeValue(project: TranspileProject, value: string, varType: string): string {
  const baseType = resolveBaseType(varType, project)
  if (baseType === 'STRING' && !value.startsWith("'") && !value.endsWith("'")) {
    return `'${value}'`
  }
  if (baseType === 'WSTRING' && !value.startsWith('"') && !value.endsWith('"')) {
    return `"${value}"`
  }
  return value
}
