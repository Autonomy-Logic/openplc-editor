// FIM (Fill-in-the-Middle) context builder for AI inline completions.
import type * as monaco from 'monaco-editor'

import type { AICompletionLanguage } from '../../../middleware/shared/ports/ai-port'
import { openPLCStoreBase } from '../../store'
import { collectProjectContext, formatIecVariables, formatPythonVariables } from './context-collector'

const MAX_PREFIX_CHARS = 3000
const MAX_SUFFIX_CHARS = 1000
const PROJECT_CONTEXT_TOKEN_BUDGET = 3000

export type FIMContext = {
  prefix: string
  suffix: string
  projectContext: string
  language: AICompletionLanguage
}

const POU_TYPE_KEYWORDS: Record<string, string> = {
  program: 'PROGRAM',
  function: 'FUNCTION',
  'function-block': 'FUNCTION_BLOCK',
}

const POU_END_KEYWORDS: Record<string, string> = {
  program: 'END_PROGRAM',
  function: 'END_FUNCTION',
  'function-block': 'END_FUNCTION_BLOCK',
}

let contextCache: {
  pouName: string
  language: string
  pousRef: unknown
  dataTypesRef: unknown
  globalVarsRef: unknown
  result: string
} | null = null

// Builds a synthetic POU header prepended to the FIM prefix, since the editor only shows the body.
function buildSyntheticHeader(pouName: string, language: string): string {
  const state = openPLCStoreBase.getState()
  const pou = state.project.data.pous.find((p) => p.name === pouName)
  if (!pou) return ''

  if (language === 'st' || language === 'il') {
    const typeKeyword = POU_TYPE_KEYWORDS[pou.pouType]
    if (!typeKeyword) return ''
    const pouVars = pou.interface?.variables ?? []
    const vars = pouVars.length > 0 ? formatIecVariables(pouVars) + '\n' : ''
    return `${typeKeyword} ${pou.name}\n${vars}\n`
  }

  if (language === 'python') {
    const pouVars = pou.interface?.variables ?? []
    const vars = pouVars.length > 0 ? '\n' + formatPythonVariables(pouVars) : ''
    return `# POU: ${pou.name} (${pou.pouType})${vars}\n\n`
  }

  if (language === 'cpp') {
    const pouVars = pou.interface?.variables ?? []
    const vars = pouVars.length > 0 ? '\n' + pouVars.map((v) => `//   ${v.name}: ${v.type.value}`).join('\n') : ''
    return `// POU: ${pou.name} (${pou.pouType})${vars}\n\n`
  }

  return ''
}

export function buildFIMContext(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  pouName: string,
  language: AICompletionLanguage,
): FIMContext {
  const fullText = model.getValue()
  const offset = model.getOffsetAt(position)

  // Synthetic header takes priority in the prefix budget — a typical header is 100-300 chars
  const header = buildSyntheticHeader(pouName, language)
  const maxCodePrefix = MAX_PREFIX_CHARS - header.length
  const prefix = header + fullText.substring(Math.max(0, offset - maxCodePrefix), offset)
  let suffix = fullText.substring(offset, Math.min(fullText.length, offset + MAX_SUFFIX_CHARS))

  // The boundary keyword goes a blank line below the cursor (`\n\n…`): jammed against it, the model reads the
  // span as already-closed and returns an empty completion.
  if (suffix.trim().length === 0) {
    if (language === 'st' || language === 'il') {
      const state = openPLCStoreBase.getState()
      const pou = state.project.data.pous.find((p) => p.name === pouName)
      const endKeyword = pou ? POU_END_KEYWORDS[pou.pouType] : undefined
      if (endKeyword) {
        suffix = `\n\n${endKeyword}`
      }
    } else if (language === 'python') {
      suffix = '\n\n# END POU'
    } else if (language === 'cpp') {
      suffix = '\n\n// END POU'
    }
  }

  const projectContext = getCachedProjectContext(pouName, language)

  return { prefix, suffix, projectContext, language }
}

// Single-entry cache, invalidated on a POU/language change or a Zustand state reference change.
function getCachedProjectContext(pouName: string, language: AICompletionLanguage): string {
  const state = openPLCStoreBase.getState()
  const pousRef = state.project.data.pous
  const dataTypesRef = state.project.data.dataTypes
  const globalVarsRef = state.project.data.configurations.resource.globalVariables

  if (
    contextCache &&
    contextCache.pouName === pouName &&
    contextCache.language === language &&
    contextCache.pousRef === pousRef &&
    contextCache.dataTypesRef === dataTypesRef &&
    contextCache.globalVarsRef === globalVarsRef
  ) {
    return contextCache.result
  }

  const result = collectProjectContext(state, pouName, PROJECT_CONTEXT_TOKEN_BUDGET, language)

  contextCache = { pouName, language, pousRef, dataTypesRef, globalVarsRef, result }

  return result
}
