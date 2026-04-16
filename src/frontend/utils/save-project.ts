/**
 * Save project utilities — POU sanitization and debug variable collection.
 *
 * These functions are shared by both full project save (executeSaveProject)
 * and single-file save (executeSaveFile) to ensure identical serialization.
 */

import type { PLCPou } from '../../middleware/shared/ports/types'

// ---------------------------------------------------------------------------
// Structural types (avoids store layer import — architecture rule)
// ---------------------------------------------------------------------------

/** Minimal editor shape needed for POU sanitization. */
export interface EditorLike {
  type: string
  meta: { name: string }
  variable?: { display: string; code?: string | null }
}

// ---------------------------------------------------------------------------
// POU Sanitization
// ---------------------------------------------------------------------------

/**
 * Syncs a POU's variablesText with the current code editor state.
 *
 * When a user edits variables in "code" display mode, the text lives in the
 * editor model but hasn't been parsed back into structured variables yet.
 * Before saving we must capture that text so the IPC layer writes it to disk.
 */
export function sanitizePou(pou: PLCPou, editor: EditorLike | undefined): PLCPou {
  if (!editor || (editor.type !== 'plc-textual' && editor.type !== 'plc-graphical') || !editor.variable) {
    return pou
  }

  if (editor.variable.display === 'code' && editor.variable.code != null) {
    return {
      ...pou,
      variablesText: editor.variable.code,
    } as PLCPou & { variablesText?: string }
  }

  return pou
}

// ---------------------------------------------------------------------------
// Debug Variable Collection
// ---------------------------------------------------------------------------

/**
 * Collects debug flags from all variables (global + per-POU).
 * Returns undefined if no variables have debug enabled.
 */
export function collectDebugVariables(
  globalVariables: { name: string; debug?: boolean }[],
  pous: PLCPou[],
): { global?: string[]; pous?: Record<string, string[]> } | undefined {
  const debugVars: { global?: string[]; pous?: Record<string, string[]> } = {}

  const globalDebug = globalVariables.filter((v) => v.debug === true).map((v) => v.name)
  if (globalDebug.length > 0) {
    debugVars.global = globalDebug
  }

  const pouDebug: Record<string, string[]> = {}
  for (const pou of pous) {
    const vars = (pou.interface?.variables ?? []).filter((v) => v.debug === true).map((v) => v.name)
    if (vars.length > 0) {
      pouDebug[pou.name] = vars
    }
  }
  if (Object.keys(pouDebug).length > 0) {
    debugVars.pous = pouDebug
  }

  return debugVars.global || debugVars.pous ? debugVars : undefined
}
