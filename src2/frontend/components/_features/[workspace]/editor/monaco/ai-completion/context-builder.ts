import { openPLCStoreBase } from '../../../../../../store'
import type * as monaco from 'monaco-editor'

/** Maximum characters to extract before cursor for FIM prefix */
const MAX_PREFIX_CHARS = 3000
/** Maximum characters to extract after cursor for FIM suffix */
const MAX_SUFFIX_CHARS = 1000
/** Token budget for project context in inline completions */
const PROJECT_CONTEXT_TOKEN_BUDGET = 2000

export type FIMContext = {
  prefix: string
  suffix: string
  projectContext: string
  language: 'st' | 'il' | 'python' | 'cpp'
}

/**
 * Collects project context for AI completions.
 * Extracts POU names, types, and variable signatures from the project store.
 * This is a simplified version that works without the dedicated context-collector service.
 */
function collectProjectContext(pouName: string, maxTokenBudget: number): string {
  const state = openPLCStoreBase.getState()
  const pous = state.project.data.pous
  const lines: string[] = []
  let approxTokens = 0

  for (const pou of pous) {
    if (pou.name === pouName) continue
    const header = `${pou.pouType} ${pou.name}`
    const vars = (pou.interface?.variables ?? [])
      .slice(0, 10)
      .map((v) => `  ${v.class ?? 'local'} ${v.name}: ${v.type.value}`)
      .join('\n')
    const block = `${header}\n${vars}`
    const blockTokens = Math.ceil(block.length / 4)
    if (approxTokens + blockTokens > maxTokenBudget) break
    lines.push(block)
    approxTokens += blockTokens
  }

  return lines.join('\n\n')
}

/**
 * Builds Fill-in-the-Middle context from a Monaco editor model and cursor position.
 * Extracts prefix/suffix code around the cursor and collects project-level context.
 */
export function buildFIMContext(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  pouName: string,
  language: 'st' | 'il' | 'python' | 'cpp',
): FIMContext {
  const fullText = model.getValue()
  const offset = model.getOffsetAt(position)

  const prefix = fullText.substring(Math.max(0, offset - MAX_PREFIX_CHARS), offset)
  const suffix = fullText.substring(offset, Math.min(fullText.length, offset + MAX_SUFFIX_CHARS))

  const projectContext = collectProjectContext(pouName, PROJECT_CONTEXT_TOKEN_BUDGET)

  return { prefix, suffix, projectContext, language }
}
