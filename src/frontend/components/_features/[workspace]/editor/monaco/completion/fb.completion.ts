import { PLCProject } from '@root/middleware/shared/ports/types'
import { escapeRegExp } from 'lodash'
import * as monaco from 'monaco-editor'

import type { SystemLibraryPou } from '../../../../../../../middleware/shared/ports/library-types'
import { openPLCStoreBase } from '../../../../../../store'
import type { VariableDTO } from '../../../../../../store/slices/project'

/**
 * Find a function block named `typeName` across every loaded system
 * library (.stlib bundle). Returns the first match — FB names are
 * unique across IEC libraries by convention. Returns undefined when
 * libraries haven't loaded yet (early startup) or when the type
 * belongs to a user-defined POU instead.
 */
function findSystemFB(typeName: string): SystemLibraryPou | undefined {
  const upper = typeName.toUpperCase()
  for (const lib of openPLCStoreBase.getState().libraries.system) {
    const fb = lib.pous.find((pou) => pou.name === upper && pou.type === 'function-block')
    if (fb) return fb
  }
  return undefined
}

interface FBCompletionContext {
  isAfterDot: boolean
  instancePath: string[] // Changed: array to support multi-level
  instanceName: string | null
  instanceType: string | null
}

/**
 * Analyzes the context to determine if we're accessing FB variables (multi-level support)
 */
function analyzeContext(model: monaco.editor.ITextModel, position: monaco.IPosition): FBCompletionContext {
  const line = model.getLineContent(position.lineNumber)
  const textBeforeCursor = line.substring(0, position.column - 1)

  // Detect patterns like: LocalVar.MyCustomVar. or LocalVar.MyCustomVar.timer.
  const multiLevelMatch = textBeforeCursor.match(/(\w+(?:\.\w+)*?)\.(\w*)$/)

  if (multiLevelMatch) {
    const fullPath = multiLevelMatch[1] // "LocalVar.MyCustomVar"
    const instancePath = fullPath.split('.') // ["LocalVar", "MyCustomVar"]
    const instanceName = instancePath[0] // "LocalVar"

    return {
      isAfterDot: true,
      instancePath,
      instanceName,
      instanceType: null,
    }
  }

  return {
    isAfterDot: false,
    instancePath: [],
    instanceName: null,
    instanceType: null,
  }
}

/**
 * Find the final type by traversing the path recursively
 */
function findFinalType(
  instancePath: string[],
  pouVariables: VariableDTO['data'][] = [],
  customFBs: PLCProject['pous'] = [],
): { type: string; isStandard: boolean } | null {
  if (instancePath.length === 0) return null

  // Start with the first variable (e.g., "LocalVar")
  const rootVariable = pouVariables.find((v) => v.name === instancePath[0])
  if (
    !rootVariable ||
    (rootVariable.type?.definition !== 'derived' && rootVariable.type?.definition !== 'user-data-type')
  ) {
    return null
  }

  let currentTypeName = rootVariable.type.value
  let currentPath = 1 // Start at the second element of the path

  // Navigate through the remaining path
  while (currentPath < instancePath.length) {
    const fieldName = instancePath[currentPath]

    // First, check if it's a system library FB (any loaded .stlib)
    const systemFB = findSystemFB(currentTypeName)
    if (systemFB) {
      const field = systemFB.variables.find(
        (v) => v.name === fieldName && (v.class === 'input' || v.class === 'output'),
      )
      if (field) {
        currentTypeName = field.type.value
      } else {
        return null
      }
    } else {
      // Check if it's a Custom FB
      const customFB = customFBs.find(
        (fb) => fb.name.toUpperCase() === currentTypeName.toUpperCase() && fb.pouType === 'function-block',
      )
      if (customFB) {
        const field = (customFB.interface?.variables ?? []).find(
          (v) => v.name === fieldName && (v.class === 'input' || v.class === 'output' || v.class === 'inOut'),
        )
        if (field && (field.type?.definition === 'derived' || field.type?.definition === 'user-data-type')) {
          currentTypeName = field.type.value
        } else {
          return null
        }
      } else {
        return null
      }
    }

    currentPath++
  }

  // Determine whether the final type belongs to a system library or a
  // user-defined POU.
  const isStandard = findSystemFB(currentTypeName) !== undefined

  return { type: currentTypeName, isStandard }
}

/**
 * Find function block type (both standard and custom) from variable declarations
 */
function findFBType(
  code: string,
  instanceName: string,
  pouVariables: VariableDTO['data'][] = [],
  customFBs: PLCProject['pous'] = [],
): { type: string; isStandard: boolean } | null {
  // First, check in POU variables (from the store)
  const pouVariable = pouVariables.find((variable) => {
    const matches =
      variable.name === instanceName &&
      (variable.type?.definition === 'derived' || variable.type?.definition === 'user-data-type')
    return matches
  })

  if (pouVariable) {
    const typeName = pouVariable.type.value.toUpperCase()

    // Check system libraries (any loaded .stlib) first
    const systemFB = findSystemFB(typeName)
    if (systemFB) {
      return { type: systemFB.name, isStandard: true }
    }

    // Check if it's a Custom FB
    const customFB = customFBs.find((fb) => fb.name.toUpperCase() === typeName && fb.pouType === 'function-block')
    if (customFB) {
      return { type: customFB.name, isStandard: false }
    }
  }

  // Fallback: parse code for declarations like "myTimer : TON;"
  const declarationRegex = new RegExp(`\\b${escapeRegExp(instanceName)}\\s*:\\s*(\\w+)\\s*;`, 'i')
  const match = code.match(declarationRegex)

  if (match) {
    const typeName = match[1].toUpperCase()

    // Check system libraries first
    const systemFB = findSystemFB(typeName)
    if (systemFB) {
      return { type: systemFB.name, isStandard: true }
    }

    // Check Custom FBs
    const customFB = customFBs.find((fb) => fb.name.toUpperCase() === typeName && fb.pouType === 'function-block')
    if (customFB) {
      return { type: customFB.name, isStandard: false }
    }
  }

  return null
}

/**
 * Get variable suggestions for system library Function Blocks (any
 * loaded .stlib bundle: standard, additional, OSCAT, std-functions, …).
 */
function getStandardFBVariableSuggestions(
  fbType: string,
  range: monaco.IRange,
  editorName: string,
): monaco.languages.CompletionItem[] {
  const systemFB = findSystemFB(fbType)
  if (!systemFB) return []

  // Filter only public variables (Input, Output) - 'local' are private
  const publicVariables = systemFB.variables
    .filter((variable) => variable.class === 'input' || variable.class === 'output')
    .filter((variable) => variable.name !== editorName)

  return publicVariables.map((variable) => ({
    label: variable.name,
    kind: monaco.languages.CompletionItemKind.Field,
    insertText: variable.name,
    detail: `${variable.type.value} (${variable.class})`,
    documentation: {
      value: `**${variable.name}** - ${variable.class} variable\n\nType: \`${variable.type.value}\`\n\nFunction Block: ${fbType}\n\n${variable.documentation || systemFB.documentation}`,
    },
    range,
    sortText: `${variable.class === 'input' ? '1' : variable.class === 'output' ? '2' : '3'}_${variable.name}`,
  }))
}

/**
 * Get variable suggestions for Custom Function Blocks
 */
function getCustomFBVariableSuggestions(
  fbType: string,
  customFBs: PLCProject['pous'],
  range: monaco.IRange,
  editorName: string,
): monaco.languages.CompletionItem[] {
  const functionBlock = customFBs.find((fb) => fb.name === fbType && fb.pouType === 'function-block')

  if (!functionBlock) return []

  // Filter only public variables (Input, Output, InOut) - same as Standard FBs
  const publicVariables = (functionBlock.interface?.variables ?? [])
    .filter((variable) => variable.class === 'input' || variable.class === 'output' || variable.class === 'inOut')
    .filter((variable) => variable.name !== editorName)

  return publicVariables.map((variable) => ({
    label: variable.name,
    kind: monaco.languages.CompletionItemKind.Field,
    insertText: variable.name,
    detail: `${variable.type.value} (${variable.class})`,
    documentation: {
      value: `**${variable.name}** - ${variable.class} variable\n\nType: \`${variable.type.value}\`\n\nCustom Function Block: ${fbType}\n\n${variable.documentation || functionBlock.documentation}`,
    },
    range,
    sortText: `${variable.class === 'input' ? '1' : variable.class === 'output' ? '2' : '3'}_${variable.name}`,
  }))
}

/**
 * Get custom function block instance suggestions (for direct FB calls)
 */
function getCustomFBInstanceSuggestions(
  customFBs: PLCProject['pous'],
  range: monaco.IRange,
  editorName: string,
): monaco.languages.CompletionItem[] {
  return customFBs
    .filter((fb) => fb.pouType === 'function-block')
    .filter((fb) => fb.name !== editorName)
    .map((fb) => {
      const variables = fb.interface?.variables ?? []
      const inputVars = variables.filter((v) => v.class === 'input')

      // Generate snippet with input parameters
      let snippet = `${fb.name}(`
      if (inputVars.length > 0) {
        snippet += '\n'
        inputVars.forEach((input, index) => {
          const placeholder = index + 1
          snippet += `\t${input.name} := \${${placeholder}:value}`
          if (index < inputVars.length - 1) snippet += ','
          snippet += '\n'
        })
      }
      snippet += ')'

      return {
        label: fb.name,
        kind: monaco.languages.CompletionItemKind.Class,
        insertText: snippet,
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        detail: `Custom Function Block`,
        documentation: {
          value: `**${fb.name}** - Custom Function Block\n\n${fb.documentation || 'User-defined function block'}\n\n**Variables:**\n${variables.map((v) => `- **${v.name}** (${v.class}): ${v.type.value}`).join('\n')}`,
        },
        range,
        sortText: `2_${fb.name}`, // Sort after standard FBs
      }
    })
}

/**
 * Main completion provider for Function Blocks (Standard + Custom) with Multi-level support
 */
export const fbCompletion = ({
  model,
  position,
  range,
  editorName,
  pouVariables = [],
  customFBs = [],
}: {
  model: monaco.editor.ITextModel
  position: monaco.IPosition
  range: monaco.IRange
  editorName: string
  pouVariables?: VariableDTO['data'][]
  customFBs?: PLCProject['pous']
}) => {
  const context = analyzeContext(model, position)
  const code = model.getValue()

  if (context.isAfterDot && context.instancePath.length > 0) {
    let fbResult: { type: string; isStandard: boolean } | null = null

    if (context.instancePath.length === 1) {
      // Single level: LocalVar.
      fbResult = findFBType(code, context.instancePath[0], pouVariables, customFBs)
    } else {
      // Multi-level: LocalVar.MyCustomVar.
      fbResult = findFinalType(context.instancePath, pouVariables, customFBs)
    }

    if (fbResult) {
      let suggestions: monaco.languages.CompletionItem[] = []

      if (fbResult.isStandard) {
        suggestions = getStandardFBVariableSuggestions(fbResult.type, range, editorName)
      } else {
        suggestions = getCustomFBVariableSuggestions(fbResult.type, customFBs, range, editorName)
      }

      return { suggestions }
    }
  } else {
    const suggestions = getCustomFBInstanceSuggestions(customFBs, range, editorName)

    return { suggestions }
  }

  return { suggestions: [] }
}
