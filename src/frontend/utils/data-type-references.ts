import type { PLCDataType, PLCPou, PLCVariable, PLCVariableType } from '../../middleware/shared/ports/types'
import type {
  DataTypeReferenceImpactAnalysis,
  DataTypeReferenceKind,
  DataTypeReferenceLocation,
} from './data-type-references/types'

/** Container label used for references declared in the global variables table. */
export const GLOBAL_VARIABLES_CONTAINER = 'Global Variables'

// IEC identifiers are case-insensitive — same rule as the store's data type name checks.
const nameMatches = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

const KIND_GROUP: Record<DataTypeReferenceKind, string> = {
  'pou-variable': 'POU variables',
  'global-variable': 'global variables',
  'data-type-field': 'data types',
  'data-type-base-type': 'data types',
}

/** True when `type` references the data type `typeName` — directly or as an array base type. */
export function variableTypeReferencesDataType(type: PLCVariableType, typeName: string): boolean {
  if (type.definition === 'user-data-type') {
    return nameMatches(type.value, typeName)
  }
  if (type.definition === 'array') {
    const baseType = type.data?.baseType
    return baseType !== undefined && baseType.definition === 'user-data-type' && nameMatches(baseType.value, typeName)
  }
  return false
}

/**
 * Find every place `typeName` is referenced as a type: POU variables, global
 * variables, other structures' fields, and other array data types' base types.
 * Mirrors `findAllReferencesToVariable` and returns the same analysis shape so
 * the rename impact modal renders it unchanged.
 */
export function findAllReferencesToDataType(
  typeName: string,
  pous: PLCPou[],
  globalVariables: PLCVariable[],
  dataTypes: PLCDataType[],
): DataTypeReferenceImpactAnalysis {
  const references: DataTypeReferenceLocation[] = []

  pous.forEach((pou) => {
    ;(pou.interface?.variables ?? []).forEach((variable) => {
      if (variableTypeReferencesDataType(variable.type, typeName)) {
        references.push({ kind: 'pou-variable', container: pou.name, variableName: variable.name })
      }
    })
  })

  globalVariables.forEach((variable) => {
    if (variableTypeReferencesDataType(variable.type, typeName)) {
      references.push({ kind: 'global-variable', container: GLOBAL_VARIABLES_CONTAINER, variableName: variable.name })
    }
  })

  dataTypes.forEach((dataType) => {
    if (dataType.derivation === 'structure') {
      dataType.variable.forEach((field) => {
        if (variableTypeReferencesDataType(field.type, typeName)) {
          references.push({ kind: 'data-type-field', container: dataType.name, variableName: field.name })
        }
      })
    } else if (dataType.derivation === 'array') {
      if (variableTypeReferencesDataType(dataType.baseType, typeName)) {
        references.push({ kind: 'data-type-base-type', container: dataType.name })
      }
    }
  })

  const byPou = new Map<string, number>()
  const byEditorType = new Map<string, number>()
  references.forEach((ref) => {
    byPou.set(ref.container, (byPou.get(ref.container) ?? 0) + 1)
    const group = KIND_GROUP[ref.kind]
    byEditorType.set(group, (byEditorType.get(group) ?? 0) + 1)
  })

  return {
    totalReferences: references.length,
    byPou,
    byEditorType,
    references,
  }
}

/**
 * Rewrite a reference to `oldName` inside a variable type, or return `null`
 * when the type doesn't reference it.
 */
export function renameDataTypeInVariableType(
  type: PLCVariableType,
  oldName: string,
  newName: string,
): PLCVariableType | null {
  if (type.definition === 'user-data-type' && nameMatches(type.value, oldName)) {
    return { ...type, value: newName }
  }
  if (type.definition === 'array' && type.data) {
    const { baseType, dimensions } = type.data
    if (baseType.definition === 'user-data-type' && nameMatches(baseType.value, oldName)) {
      const dims = dimensions.map((d) => d.dimension).join(', ')
      return {
        ...type,
        // `value` is what variable serialization emits — rebuild it or the
        // saved declaration keeps the old base type name.
        value: `ARRAY [${dims}] OF ${newName}`,
        data: { ...type.data, baseType: { ...baseType, value: newName } },
      }
    }
  }
  return null
}

/**
 * Rewrite references to `oldName` inside another data type (structure fields,
 * array base type), or return `null` when nothing references it.
 */
export function renameDataTypeInDataType(dataType: PLCDataType, oldName: string, newName: string): PLCDataType | null {
  if (dataType.derivation === 'structure') {
    let changed = false
    const fields = dataType.variable.map((field) => {
      const nextType = renameDataTypeInVariableType(field.type, oldName, newName)
      if (!nextType) return field
      changed = true
      return { ...field, type: nextType }
    })
    return changed ? { ...dataType, variable: fields } : null
  }
  if (dataType.derivation === 'array') {
    const nextBaseType = renameDataTypeInVariableType(dataType.baseType, oldName, newName)
    return nextBaseType ? { ...dataType, baseType: nextBaseType } : null
  }
  return null
}
