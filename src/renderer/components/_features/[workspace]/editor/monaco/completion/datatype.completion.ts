import { VariableDTO } from '@root/renderer/store/slices'
import { PLCDataType, PLCStructureVariable } from '@root/types/PLC/open-plc'
import { escapeRegExp } from 'lodash'
import * as monaco from 'monaco-editor'

interface DataTypeCompletionContext {
  isAfterDot: boolean
  instancePath: string[] // Changed: array to support multi-level like ["B", "J"]
  instanceName: string | null
  instanceType: string | null
  isArrayAccess: boolean
  arrayPath: string
}

/**
 * Analyzes the context to determine if we're accessing data type fields (multi-level support)
 */
function analyzeContext(model: monaco.editor.ITextModel, position: monaco.IPosition): DataTypeCompletionContext {
  const line = model.getLineContent(position.lineNumber)
  const textBeforeCursor = line.substring(0, position.column - 1)

  // UPDATED: Detect nested array access patterns: myStruct.arrayField[0]. or myStruct.arrayField[0].field.
  const nestedArrayAccessMatch = textBeforeCursor.match(
    /(\w+)\.(\w+(?:\.\w+)*?)\[([^\]]+)\](?:\.(\w+(?:\.\w+)*?))?\.(\w*)$/,
  )

  if (nestedArrayAccessMatch) {
    const rootName = nestedArrayAccessMatch[1]
    const arrayFieldPath = nestedArrayAccessMatch[2]
    const arrayIndex = nestedArrayAccessMatch[3]
    const fieldPath = nestedArrayAccessMatch[4] || ''
    const arrayPath = `${rootName}.${arrayFieldPath}[${arrayIndex}]`

    // Build instance path: [rootName, ...arrayFieldPath, ...fieldPath]
    const instancePath = [rootName, ...arrayFieldPath.split('.'), ...(fieldPath ? fieldPath.split('.') : [])]

    return {
      isAfterDot: true,
      instancePath,
      instanceName: rootName,
      instanceType: null,
      isArrayAccess: true,
      arrayPath,
    }
  }

  // Existing array access patterns: myArray[0]. or myArray[0].field.
  const arrayAccessMatch = textBeforeCursor.match(/(\w+)\[([^\]]+)\](?:\.(\w+(?:\.\w+)*?))?\.(\w*)$/)

  if (arrayAccessMatch) {
    const arrayName = arrayAccessMatch[1]
    const arrayIndex = arrayAccessMatch[2]
    const fieldPath = arrayAccessMatch[3] || ''
    const arrayPath = `${arrayName}[${arrayIndex}]`

    const instancePath = fieldPath ? [arrayName, ...fieldPath.split('.')] : [arrayName]

    return {
      isAfterDot: true,
      instancePath,
      instanceName: arrayName,
      instanceType: null,
      isArrayAccess: true,
      arrayPath,
    }
  }

  // Existing multi-level detection
  const multiLevelMatch = textBeforeCursor.match(/(\w+(?:\.\w+)*?)\.(\w*)$/)

  if (multiLevelMatch) {
    const fullPath = multiLevelMatch[1]
    const instancePath = fullPath.split('.')
    const instanceName = instancePath[0]

    return {
      isAfterDot: true,
      instancePath,
      instanceName,
      instanceType: null,
      isArrayAccess: false,
      arrayPath: '',
    }
  }

  return {
    isAfterDot: false,
    instancePath: [],
    instanceName: null,
    instanceType: null,
    isArrayAccess: false,
    arrayPath: '',
  }
}
/**
 * Find the final data type by traversing the path recursively
 */
function findFinalDataType(
  instancePath: string[],
  pouVariables: VariableDTO['data'][] = [],
  customDataTypes: PLCDataType[] = [],
  isArrayAccess: boolean = false,
): PLCDataType | null {
  if (instancePath.length === 0) return null

  let currentDataType: PLCDataType | null = null

  // Determine initial type based on array access or regular access
  if (isArrayAccess) {
    // For nested arrays like LocalVar.structureVar[1]., we need to find the root type first
    const rootVariable = pouVariables.find((v) => v.name === instancePath[0])
    if (!rootVariable || rootVariable.type?.definition !== 'user-data-type') {
      // Try direct array access (LocalVar0[1].)
      currentDataType = findArrayDataType(instancePath[0], pouVariables, customDataTypes)
      if (!currentDataType) return null
    } else {
      // Regular structure access first
      const foundDataType = customDataTypes.find(
        (dt) => dt.name.toUpperCase() === rootVariable.type.value.toUpperCase(),
      )
      if (!foundDataType) return null
      currentDataType = foundDataType
    }
  } else {
    // Regular access logic
    const rootVariable = pouVariables.find((v) => v.name === instancePath[0])
    if (!rootVariable || rootVariable.type?.definition !== 'user-data-type') {
      return null
    }
    const foundDataType = customDataTypes.find((dt) => dt.name.toUpperCase() === rootVariable.type.value.toUpperCase())

    if (!foundDataType) return null

    // Return null if root type is enumerated (no dot properties)
    if (foundDataType.derivation === 'enumerated') {
      return null
    }

    currentDataType = foundDataType
  }

  // Navigate through the path
  let currentPath = 1

  while (currentPath < instancePath.length) {
    const fieldName = instancePath[currentPath]

    // For structures, find the field
    if (currentDataType && currentDataType.derivation === 'structure') {
      const field: PLCStructureVariable | undefined = currentDataType.variable.find((v) => v.name === fieldName)
      if (!field) {
        return null
      }

      // Check if field is an array that we're accessing
      if (field.type.definition === 'array' && isArrayAccess) {
        // This is an array field being accessed with brackets
        // Find the element type of the array
        const arrayTypeMatch: RegExpMatchArray | null = field.type.value?.match(/ARRAY\s*\[.*?\]\s+OF\s+(\w+)/i)
        if (arrayTypeMatch) {
          const elementTypeName: string = arrayTypeMatch[1]
          const foundDataType = customDataTypes.find((dt) => dt.name.toUpperCase() === elementTypeName.toUpperCase())
          if (!foundDataType) return null
          currentDataType = foundDataType

          // Skip the next field name as it's handled by the array access
          currentPath++
          continue
        }
        return null
      }

      // Check if the field is a user-data-type
      if (field.type.definition === 'user-data-type') {
        const foundDataType: PLCDataType | undefined = customDataTypes.find(
          (dt) => dt.name.toUpperCase() === field.type.value.toUpperCase(),
        )
        if (!foundDataType) return null

        // block enum suggestions
        if (foundDataType.derivation === 'enumerated') {
          return null
        }

        currentDataType = foundDataType
      } else {
        return null
      }
    } else {
      return null
    }

    currentPath++
  }

  return currentDataType
}

/**
 * Find custom data type from variable declarations in the current POU
 */
function findCustomDataType(
  code: string,
  instanceName: string,
  pouVariables: VariableDTO['data'][] = [],
  customDataTypes: PLCDataType[] = [],
): PLCDataType | null {
  // First, check in POU variables (from the store)
  const pouVariable = pouVariables.find((variable) => variable.name === instanceName)

  if (pouVariable) {
    // CHECK: Handle user-data-type
    if (pouVariable.type?.definition === 'user-data-type') {
      const foundDataType = customDataTypes.find((dt) => dt.name.toUpperCase() === pouVariable.type.value.toUpperCase())

      // Return null if it's an enumerated type (no dot properties)
      if (foundDataType && foundDataType.derivation === 'enumerated') {
        return null
      }

      return foundDataType || null
    }
  }

  // Fallback: parse code for declarations like "myStruct : MyStructType;"
  const declarationRegex = new RegExp(`\\b${escapeRegExp(instanceName)}\\s*:\\s*(\\w+)\\s*;`, 'i')
  const match = code.match(declarationRegex)

  if (match) {
    const typeName = match[1]
    const foundDataType = customDataTypes.find((dt) => {
      return dt.name.toUpperCase() === typeName.toUpperCase()
    })
    return foundDataType || null
  }

  return null
}

/**
 * Find the data type of an array variable
 */
function findArrayDataType(
  arrayName: string,
  pouVariables: VariableDTO['data'][] = [],
  customDataTypes: PLCDataType[] = [],
): PLCDataType | null {
  const arrayVariable = pouVariables.find((v) => v.name === arrayName)

  if (!arrayVariable) return null

  if (arrayVariable.type?.definition === 'array') {
    // FIX: Try to use data.baseType first (more reliable)
    if (arrayVariable.type.data?.baseType?.definition === 'user-data-type') {
      const elementTypeName = arrayVariable.type.data.baseType.value
      const foundDataType = customDataTypes.find((dt) => dt.name.toUpperCase() === elementTypeName.toUpperCase())

      return foundDataType || null
    }

    // FALLBACK: Parse the string (with improved regex)
    const arrayTypeMatch = arrayVariable.type.value.match(/ARRAY\s*\[.*?\]\s+OF\s+(\w+)/i)

    if (arrayTypeMatch) {
      const elementTypeName = arrayTypeMatch[1]
      const foundDataType = customDataTypes.find((dt) => dt.name.toUpperCase() === elementTypeName.toUpperCase())

      return foundDataType || null
    }
  }

  return null
}

/**
 * Get field suggestions for a specific custom structure data type
 */
function getStructureDataTypeFieldSuggestions(
  dataType: PLCDataType,
  range: monaco.IRange,
): monaco.languages.CompletionItem[] {
  if (dataType.derivation !== 'structure') return []

  return dataType.variable.map((variable) => ({
    label: variable.name,
    kind: monaco.languages.CompletionItemKind.Field,
    insertText: variable.name,
    detail: `${variable.type.value} (${variable.type.definition})`,
    documentation: {
      value: `**${variable.name}** - Field of structure ${dataType.name}\n\nType: \`${variable.type.value}\`\n\nDefinition: \`${variable.type.definition}\``,
    },
    range,
    sortText: `1_${variable.name}`,
  }))
}

/**
 * Get value suggestions for a specific custom enumerated data type
 */
function getEnumeratedDataTypeValueSuggestions(
  dataType: PLCDataType,
  range: monaco.IRange,
): monaco.languages.CompletionItem[] {
  if (dataType.derivation !== 'enumerated') return []

  return dataType.values.map((value, index) => ({
    label: value.description,
    kind: monaco.languages.CompletionItemKind.EnumMember,
    insertText: value.description,
    detail: `Enumerated value`,
    documentation: {
      value: `**${value.description}** - Value of enumerated type ${dataType.name}\n\nIndex: ${index}`,
    },
    range,
    sortText: `1_${String(index).padStart(3, '0')}_${value.description}`,
  }))
}

/**
 * Get ALL enum values from ALL custom data types (for global suggestions)
 */
function getAllEnumValueSuggestions(
  customDataTypes: PLCDataType[],
  range: monaco.IRange,
): monaco.languages.CompletionItem[] {
  const allEnumValues: monaco.languages.CompletionItem[] = []

  customDataTypes
    .filter((dt) => dt.derivation === 'enumerated')
    .forEach((enumDataType) => {
      enumDataType.values.forEach((value, index) => {
        allEnumValues.push({
          label: value.description,
          kind: monaco.languages.CompletionItemKind.EnumMember,
          insertText: value.description,
          detail: `${enumDataType.name} enum value`,
          documentation: {
            value: `**${value.description}** - Value of enumerated type ${enumDataType.name}\n\nIndex: ${index}\n\nEnum Type: ${enumDataType.name}`,
          },
          range,
          sortText: `0_${value.description}`, // Higher priority than other suggestions
        })
      })
    })

  return allEnumValues
}

/**
 * Get custom data type instance suggestions (for type declarations)
 */
function getCustomDataTypeInstanceSuggestions(
  customDataTypes: PLCDataType[],
  range: monaco.IRange,
): monaco.languages.CompletionItem[] {
  return customDataTypes.map((dt) => {
    let detail = ''
    let documentation = ''
    let kind = monaco.languages.CompletionItemKind.Class

    if (dt.derivation === 'structure') {
      detail = 'Structure Data Type'
      kind = monaco.languages.CompletionItemKind.Struct
      documentation = `**${dt.name}** - Structure Data Type\n\nUser-defined structure type\n\n**Fields:**\n${dt.variable.map((v) => `- **${v.name}**: ${v.type.value} (${v.type.definition})`).join('\n')}`
    } else if (dt.derivation === 'enumerated') {
      detail = 'Enumerated Data Type'
      kind = monaco.languages.CompletionItemKind.Enum
      documentation = `**${dt.name}** - Enumerated Data Type\n\nUser-defined enumerated type\n\n**Values:**\n${dt.values.map((v, i) => `- **${v.description}** (${i})`).join('\n')}`
    } else if (dt.derivation === 'array') {
      detail = 'Array Data Type'
      kind = monaco.languages.CompletionItemKind.Class
      documentation = `**${dt.name}** - Array Data Type\n\nUser-defined array type`
    }

    return {
      label: dt.name,
      kind,
      insertText: dt.name,
      detail,
      documentation: {
        value: documentation,
      },
      range,
      sortText: `2_${dt.name}`, // Lower priority than enum values
    }
  })
}

/**
 * Main completion provider for Custom Data Types with Multi-level support
 */
export const dataTypeCompletion = ({
  model,
  position,
  range,
  pouVariables = [],
  customDataTypes = [],
}: {
  model: monaco.editor.ITextModel
  position: monaco.IPosition
  range: monaco.IRange
  pouVariables?: VariableDTO['data'][]
  customDataTypes?: PLCDataType[]
}) => {
  const context = analyzeContext(model, position)
  const code = model.getValue()

  if (context.isAfterDot && context.instancePath.length > 0) {
    let dataType: PLCDataType | null = null

    // Handle array access
    if (context.isArrayAccess) {
      dataType = findFinalDataType(context.instancePath, pouVariables, customDataTypes, true)
    } else if (context.instancePath.length === 1) {
      dataType = findCustomDataType(code, context.instancePath[0], pouVariables, customDataTypes)
    } else {
      dataType = findFinalDataType(context.instancePath, pouVariables, customDataTypes, false)
    }

    if (dataType) {
      let suggestions: monaco.languages.CompletionItem[] = []

      if (dataType.derivation === 'structure') {
        suggestions = getStructureDataTypeFieldSuggestions(dataType, range)
      } else if (dataType.derivation === 'enumerated') {
        suggestions = getEnumeratedDataTypeValueSuggestions(dataType, range)
      }

      return { suggestions }
    }
  } else {
    const allSuggestions: monaco.languages.CompletionItem[] = []

    allSuggestions.push(...getAllEnumValueSuggestions(customDataTypes, range))

    allSuggestions.push(...getCustomDataTypeInstanceSuggestions(customDataTypes, range))

    return { suggestions: allSuggestions }
  }

  return { suggestions: [] }
}
