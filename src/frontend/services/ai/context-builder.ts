/**
 * FIM (Fill-in-the-Middle) context builder for AI inline completions.
 *
 * Web-exclusive — extracts prefix/suffix from the Monaco model, synthesizes
 * structural suffixes for ST/IL, and collects project-level context with
 * single-entry caching.
 */
import type * as monaco from 'monaco-editor'

import type { AICompletionLanguage } from '../../../middleware/shared/ports/ai-port'
import { openPLCStoreBase } from '../../store'
import { collectProjectContext, formatIecVariables, formatPythonVariables } from './context-collector'

/** Maximum characters to extract before cursor for FIM prefix */
const MAX_PREFIX_CHARS = 3000
/** Maximum characters to extract after cursor for FIM suffix */
const MAX_SUFFIX_CHARS = 1000
/** Token budget for project context in inline completions */
const PROJECT_CONTEXT_TOKEN_BUDGET = 3000

export type FIMContext = {
  prefix: string
  suffix: string
  projectContext: string
  language: AICompletionLanguage
}

/** Map POU type to its IEC 61131-3 opening keyword */
const POU_TYPE_KEYWORDS: Record<string, string> = {
  program: 'PROGRAM',
  function: 'FUNCTION',
  'function-block': 'FUNCTION_BLOCK',
}

/** Map POU type to its IEC 61131-3 closing keyword */
const POU_END_KEYWORDS: Record<string, string> = {
  program: 'END_PROGRAM',
  function: 'END_FUNCTION',
  'function-block': 'END_FUNCTION_BLOCK',
}

/** Single-entry cache for project context */
let contextCache: {
  pouName: string
  language: string
  /** Reference to the pous array — if it changes, cache is stale */
  pousRef: unknown
  /** Reference to the dataTypes array */
  dataTypesRef: unknown
  /** Reference to the globalVariables array */
  globalVarsRef: unknown
  result: string
} | null = null

/**
 * Build a synthetic POU header prepended to the FIM prefix so the model sees the full
 * structural context surrounding the code body — the editor only shows the body.
 *
 * ST/IL: IEC 61131-3 syntax (PROGRAM ... VAR_INPUT ... END_VAR)
 * Python: comment-based header (# POU: Name (type)\n# Variables:\n#   x: INT ...)
 * C++:    comment-based header (// POU: Name (type)\n// Variables:\n//   x: INT ...)
 */
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

/**
 * Builds Fill-in-the-Middle context from a Monaco editor model and cursor position.
 * Extracts prefix/suffix code around the cursor and collects project-level context.
 *
 * For ST/IL, a synthetic POU header (PROGRAM/FUNCTION/FUNCTION_BLOCK + variable
 * declarations) is prepended to the prefix, and a synthetic closing keyword is
 * appended to the suffix when the cursor is at/near the end — the editor only shows
 * the body, not the enclosing wrapper.
 */
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

  // Synthesize structural suffix when at or near the end of the editor.
  // The editor only shows the POU body — the model needs a boundary signal to
  // understand it shouldn't generate past the end.
  //
  // The boundary keyword is placed a BLANK LINE below the cursor (`\n\n…`),
  // never jammed directly against it (`\n…`). With the keyword flush against
  // the cursor the FIM span reads as already-closed — the model frequently
  // concluded nothing belonged between the two and returned an empty
  // completion (most visibly right after a trailing comment line). The blank
  // line gives it obvious room to write the body.
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

/**
 * Get project context with single-entry caching.
 * Invalidates when the POU name or language changes, or when the Zustand state
 * references change (pous, dataTypes, globalVariables arrays).
 */
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
