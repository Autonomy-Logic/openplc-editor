/**
 * The rule that decides whether a project may be compiled while a POU's declaration text does not
 * parse. A decision function in the shape of `pre-build-plc-gate`: state in, verdict out, no store,
 * no toast, no IPC, so the four GUI compiles and the headless CLI refuse in the same words.
 */

import { parseVariableDeclarations, type TypeContext } from '../../../../frontend/utils/PLC/variable-declarations'
import { codeViewBuffer, type EditorLike } from '../../../../frontend/utils/save-project'
import type { PLCPou } from '../../ports/types'

/** One POU's declaration text, and where it came from. */
export interface VariablesTextGateEntry {
  pouName: string
  text: string
  /** `code-view`: the open buffer. `unparsed`: stored text the loader could not parse. */
  source: 'code-view' | 'unparsed'
}

export interface VariablesTextGateState {
  entries: VariablesTextGateEntry[]
  context: TypeContext
}

export type VariablesTextGateVerdict =
  | { kind: 'allow' }
  | { kind: 'refuse'; reason: string; pouName: string; line?: number }

/**
 * The entries to gate, in POU order: the open code-view buffer when there is one, otherwise the
 * stored text of a POU the loader could not parse. A POU with neither is not gated.
 */
export function variablesTextGateStateFor(args: {
  pous: PLCPou[]
  editorFor: (pouName: string) => EditorLike | undefined
  context: TypeContext
}): VariablesTextGateState {
  const entries: VariablesTextGateEntry[] = []

  for (const pou of args.pous) {
    const buffer = codeViewBuffer(args.editorFor(pou.name))
    if (buffer !== undefined) {
      entries.push({ pouName: pou.name, text: buffer, source: 'code-view' })
      continue
    }
    if (pou.variablesTextUnparsed === true && pou.variablesText !== undefined) {
      entries.push({ pouName: pou.name, text: pou.variablesText, source: 'unparsed' })
    }
  }

  return { entries, context: args.context }
}

/** The first entry that does not parse refuses the build; an entry the loader rejected always does. */
export function evaluateVariablesTextGate(state: VariablesTextGateState): VariablesTextGateVerdict {
  for (const entry of state.entries) {
    const [error] = parseVariableDeclarations(entry.text, state.context).errors
    if (error) {
      return {
        kind: 'refuse',
        pouName: entry.pouName,
        line: error.line,
        reason: `The variables of "${entry.pouName}" do not parse: line ${error.line}: ${error.message}`,
      }
    }
    if (entry.source === 'unparsed') {
      return {
        kind: 'refuse',
        pouName: entry.pouName,
        reason: `The variables of "${entry.pouName}" could not be loaded. Fix them in the variables code view.`,
      }
    }
  }

  return { kind: 'allow' }
}
