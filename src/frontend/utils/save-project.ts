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
 * Prepare a POU for serialization to disk:
 *
 *   1. If the user edited variables in "code" display mode, capture the raw
 *      editor text into `variablesText` so the IPC layer writes that as the
 *      authoritative variables block.
 *   2. For graphical bodies (LD/FBD), clear transient UI state from every
 *      node — `selected`, `dragging`, and `selectedNodes`. Without this,
 *      reopening a project loads nodes pre-selected, and the first deselect
 *      click triggers `updateNode` which marks the file dirty.
 *
 * Both behaviors used to live in two different helpers (`sanitizePou` and a
 * post-pass `stripGraphicalSelections`) called in lockstep at every save
 * site. Folding them together makes the contract single-source-of-truth:
 * "give me a POU ready to write to disk."
 */
export function sanitizePou(pou: PLCPou, editor: EditorLike | undefined): PLCPou {
  let next: PLCPou = pou

  if (
    editor &&
    (editor.type === 'plc-textual' || editor.type === 'plc-graphical') &&
    editor.variable &&
    editor.variable.display === 'code' &&
    editor.variable.code != null
  ) {
    next = {
      ...next,
      variablesText: editor.variable.code,
    } as PLCPou & { variablesText?: string }
  }

  return stripGraphicalSelections(next)
}

function stripGraphicalSelections(pou: PLCPou): PLCPou {
  const lang = pou.body.language
  if (lang !== 'ld' && lang !== 'fbd') return pou

  const body = pou.body.value as Record<string, unknown> | undefined
  if (!body) return pou

  if (lang === 'ld' && Array.isArray(body.rungs)) {
    return {
      ...pou,
      body: {
        ...pou.body,
        value: {
          ...body,
          rungs: (body.rungs as Array<Record<string, unknown>>).map((rung) => ({
            ...rung,
            selectedNodes: [],
            nodes: Array.isArray(rung.nodes)
              ? (rung.nodes as Array<Record<string, unknown>>).map((n) => ({
                  ...n,
                  selected: false,
                  dragging: false,
                }))
              : rung.nodes,
          })),
        },
      },
    } as PLCPou
  }

  if (lang === 'fbd' && body.rung) {
    const rung = body.rung as Record<string, unknown>
    return {
      ...pou,
      body: {
        ...pou.body,
        value: {
          ...body,
          rung: {
            ...rung,
            selectedNodes: [],
            nodes: Array.isArray(rung.nodes)
              ? (rung.nodes as Array<Record<string, unknown>>).map((n) => ({
                  ...n,
                  selected: false,
                  dragging: false,
                }))
              : rung.nodes,
          },
        },
      },
    } as PLCPou
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
