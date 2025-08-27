import { StandardFunctionBlocks } from '@root/renderer/data/library/standard-function-blocks'
import { VariableDTO } from '@root/renderer/store/slices'
import { PLCProject } from '@root/types/PLC/open-plc'
import * as monaco from 'monaco-editor'

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
  customFBs: PLCProject['data']['pous'] = [],
): { type: string; isStandard: boolean } | null {
  if (instancePath.length === 0) return null

  // Start with the first variable (e.g., "LocalVar")
  const rootVariable = pouVariables.find((v) => v.name === instancePath[0])
  if (!rootVariable || rootVariable.type?.definition !== 'derived') {
    return null
  }

  let currentTypeName = rootVariable.type.value
  let currentPath = 1 // Start at the second element of the path

  // Navigate through the remaining path
  while (currentPath < instancePath.length) {
    const fieldName = instancePath[currentPath]

    // First, check if it's a Standard FB
    const standardFB = StandardFunctionBlocks.pous.find((fb) => fb.name === currentTypeName.toUpperCase())
    if (standardFB) {
      const field = standardFB.variables.find(
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
        (fb) => fb.data.name.toUpperCase() === currentTypeName.toUpperCase() && fb.type === 'function-block',
      )
      if (customFB) {
        const field = customFB.data.variables.find(
          (v) => v.name === fieldName && (v.class === 'input' || v.class === 'output' || v.class === 'inOut'),
        )
        if (field && field.type?.definition === 'derived') {
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

  // Determine if the final type is Standard or Custom
  const isStandard = StandardFunctionBlocks.pous.some((fb) => fb.name === currentTypeName.toUpperCase())

  return { type: currentTypeName, isStandard }
}

/**
 * Find function block type (both standard and custom) from variable declarations
 */
function findFBType(
  code: string,
  instanceName: string,
  pouVariables: VariableDTO['data'][] = [],
  customFBs: PLCProject['data']['pous'] = [],
): { type: string; isStandard: boolean } | null {
  // First, check in POU variables (from the store)
  const pouVariable = pouVariables.find((variable) => {
    const matches = variable.name === instanceName && variable.type?.definition === 'derived'
    return matches
  })

  if (pouVariable) {
    const typeName = pouVariable.type.value.toUpperCase()

    // Check if it's a Standard FB first
    const standardFB = StandardFunctionBlocks.pous.find((fb) => fb.name === typeName)
    if (standardFB) {
      return { type: standardFB.name, isStandard: true }
    }

    // Check if it's a Custom FB
    const customFB = customFBs.find((fb) => fb.data.name.toUpperCase() === typeName && fb.type === 'function-block')
    if (customFB) {
      return { type: customFB.data.name, isStandard: false }
    }
  }

  // Fallback: parse code for declarations like "myTimer : TON;"
  const declarationRegex = new RegExp(`\\b${instanceName}\\s*:\\s*(\\w+)\\s*;`, 'i')
  const match = code.match(declarationRegex)

  if (match) {
    const typeName = match[1].toUpperCase()

    // Check Standard FBs
    const standardFB = StandardFunctionBlocks.pous.find((fb) => fb.name === typeName)
    if (standardFB) {
      return { type: standardFB.name, isStandard: true }
    }

    // Check Custom FBs
    const customFB = customFBs.find((fb) => fb.data.name.toUpperCase() === typeName && fb.type === 'function-block')
    if (customFB) {
      return { type: customFB.data.name, isStandard: false }
    }
  }

  return null
}

/**
 * Get variable suggestions for Standard Function Blocks
 */
function getStandardFBVariableSuggestions(
  fbType: string,
  range: monaco.IRange,
  editorName: string,
): monaco.languages.CompletionItem[] {
  const standardFB = StandardFunctionBlocks.pous.find((fb) => fb.name === fbType)
  if (!standardFB) return []

  // Filter only public variables (Input, Output) - 'local' are private
  const publicVariables = standardFB.variables
    .filter((variable) => variable.class === 'input' || variable.class === 'output')
    .filter((variable) => variable.name !== editorName)

  return publicVariables.map((variable) => ({
    label: variable.name,
    kind: monaco.languages.CompletionItemKind.Field,
    insertText: variable.name,
    detail: `${variable.type.value} (${variable.class})`,
    documentation: {
      value: `**${variable.name}** - ${variable.class} variable\n\nType: \`${variable.type.value}\`\n\nStandard Function Block: ${fbType}\n\n${variable.documentation || standardFB.documentation}`,
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
  customFBs: PLCProject['data']['pous'],
  range: monaco.IRange,
  editorName: string,
): monaco.languages.CompletionItem[] {
  const functionBlock = customFBs.find((fb) => fb.data.name === fbType && fb.type === 'function-block')

  if (!functionBlock) return []

  // Filter only public variables (Input, Output, InOut) - same as Standard FBs
  const publicVariables = functionBlock.data.variables
    .filter((variable) => variable.class === 'input' || variable.class === 'output' || variable.class === 'inOut')
    .filter((variable) => variable.name !== editorName)

  return publicVariables.map((variable) => ({
    label: variable.name,
    kind: monaco.languages.CompletionItemKind.Field,
    insertText: variable.name,
    detail: `${variable.type.value} (${variable.class})`,
    documentation: {
      value: `**${variable.name}** - ${variable.class} variable\n\nType: \`${variable.type.value}\`\n\nCustom Function Block: ${fbType}\n\n${variable.documentation || functionBlock.data.documentation}`,
    },
    range,
    sortText: `${variable.class === 'input' ? '1' : variable.class === 'output' ? '2' : '3'}_${variable.name}`,
  }))
}

/**
 * Get custom function block instance suggestions (for direct FB calls)
 */
function getCustomFBInstanceSuggestions(
  customFBs: PLCProject['data']['pous'],
  range: monaco.IRange,
  editorName: string,
): monaco.languages.CompletionItem[] {
  return customFBs
    .filter((fb) => fb.type === 'function-block')
    .filter((fb) => fb.data.name !== editorName)
    .map((fb) => {
      const inputVars = fb.data.variables.filter((v) => v.class === 'input')

      // Generate snippet with input parameters
      let snippet = `${fb.data.name}(`
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
        label: fb.data.name,
        kind: monaco.languages.CompletionItemKind.Class,
        insertText: snippet,
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        detail: `Custom Function Block`,
        documentation: {
          value: `**${fb.data.name}** - Custom Function Block\n\n${fb.data.documentation || 'User-defined function block'}\n\n**Variables:**\n${fb.data.variables.map((v) => `- **${v.name}** (${v.class}): ${v.type.value}`).join('\n')}`,
        },
        range,
        sortText: `2_${fb.data.name}`, // Sort after standard FBs
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
  customFBs?: PLCProject['data']['pous']
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
