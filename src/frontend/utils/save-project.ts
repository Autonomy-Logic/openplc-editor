/**
 * Save project utilities — POU sanitization and debug variable collection.
 *
 * These functions are shared by both full project save (executeSaveProject)
 * and single-file save (executeSaveFile) to ensure identical serialization.
 */

import type { PLCPou } from '../../middleware/shared/ports/types'
import { parseVariableDeclarations } from './PLC/variable-declarations'
import { applyVariablesToText } from './variable-text-edits'

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
  const next: PLCPou = pou

  if (
    editor &&
    (editor.type === 'plc-textual' || editor.type === 'plc-graphical') &&
    editor.variable &&
    editor.variable.display === 'code' &&
    editor.variable.code != null
  ) {
    // The live buffer is the user's most recent statement of what they want,
    // including edits they have typed but not committed. It is taken verbatim
    // and NOT reconciled below: the model has not caught up with it yet by
    // definition, and "reconciling" would delete what they just typed.
    return stripGraphicalSelections({
      ...next,
      variablesText: editor.variable.code,
    } as PLCPou & { variablesText?: string })
  }

  return stripGraphicalSelections(reconcileVariablesTextForSave(next))
}

/**
 * Last line of defence before the text is written to disk.
 *
 * The store patches `variablesText` on every mutation that goes through its
 * actions, so in practice the two already agree. This exists for the case they
 * do not: a mutation added later that forgets to patch, or one that reaches the
 * variables array by a route nobody anticipated. Because the text is what gets
 * serialised, a disagreement here is a change the user made and the file never
 * received — silent data loss, which is worth a cheap check on every save.
 *
 * Deliberately NOT applied to a live editor buffer. A buffer can legitimately
 * be ahead of the model — the user typed a declaration and saved without
 * blurring — and there is no way to tell that apart from a stale text. Between
 * dropping something they typed and keeping something the store missed, the
 * first is worse, so the buffer wins and only the stored text is reconciled.
 *
 * Resolution is one-directional and deliberate: the text is PATCHED from the
 * model, never regenerated. The model holds the newer semantic change; the text
 * holds the comments and formatting that only it can carry. Patching keeps
 * both, where regenerating would trade one for the other.
 */
function reconcileVariablesTextForSave(pou: PLCPou): PLCPou {
  const text = pou.variablesText
  if (text === undefined) return pou

  const variables = pou.interface?.variables ?? []
  const parsed = parseVariableDeclarations(text)
  // Unparseable text is preserved verbatim, as it always has been: it is the
  // user's half-finished work and the code view is where they will fix it.
  if (parsed.errors.length > 0) return pou

  const describesSameVariables =
    parsed.variables.length === variables.length &&
    parsed.variables.every((candidate, index) => {
      const expected = variables[index]
      return (
        candidate.name === expected.name &&
        candidate.type.value === expected.type.value &&
        candidate.location === expected.location &&
        (candidate.initialValue ?? '') === (expected.initialValue ?? '') &&
        candidate.class === expected.class
      )
    })

  if (describesSameVariables) return pou
  return { ...pou, variablesText: applyVariablesToText(text, variables) }
}

/**
 * Canonicalize one graphical node for persistence. Beyond clearing selection
 * state, this neutralizes runtime UI state that would otherwise byte-drift
 * the serialized file against HEAD without any semantic change:
 *
 *   - `data.hasDivergence` is a render-time decoration (library-divergence
 *     tooltip) that can leak into the store via rungLocal-derived writes.
 *   - top-level `draggable` is toggled at runtime (drag-lock while a variable
 *     input is focused); `data.draggable` is the design-time value set by the
 *     node builders, so persist that instead.
 */
function sanitizeGraphicalNode(node: Record<string, unknown>): Record<string, unknown> {
  const data = node.data as Record<string, unknown> | undefined
  const { hasDivergence: _hasDivergence, ...cleanData } = data ?? {}
  return {
    ...node,
    ...(data !== undefined ? { data: cleanData } : {}),
    selected: false,
    dragging: false,
    draggable: Boolean(cleanData.draggable),
  }
}

/**
 * Deterministic `reactFlowViewport` from content, mirroring the formula in
 * RungBody.updateReactFlowPanelExtent: bounds over all nodes plus the
 * synthetic 150×40 origin node, floored at `defaultBounds`, +20px height
 * padding. The runtime writes measured, timing-dependent values into
 * `reactFlowViewport` (window size, drag history), so persisting the raw
 * value makes byte stability depend on UI state. Serializing a pure function
 * of content keeps unchanged rungs byte-identical. Returns the existing value
 * when the rung lacks the inputs (e.g. FBD rungs have no defaultBounds).
 */
function canonicalRungViewport(rung: Record<string, unknown>): unknown {
  const nodes = rung.nodes
  const defaultBounds = rung.defaultBounds
  if (!Array.isArray(nodes) || !Array.isArray(defaultBounds)) return rung.reactFlowViewport

  let minX = 0
  let minY = 0
  let maxX = 150
  let maxY = 40
  for (const n of nodes as Array<Record<string, unknown>>) {
    const pos = n.position as { x?: number; y?: number } | undefined
    const measured = n.measured as { width?: number; height?: number } | undefined
    const x = pos?.x ?? 0
    const y = pos?.y ?? 0
    const w = measured?.width ?? (n.width as number | undefined) ?? 0
    const h = measured?.height ?? (n.height as number | undefined) ?? 0
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x + w > maxX) maxX = x + w
    if (y + h > maxY) maxY = y + h
  }

  let width = maxX - minX
  let height = maxY - minY
  const defaultWidth = Number(defaultBounds[0]) || 0
  const defaultHeight = Number(defaultBounds[1]) || 0
  if (width < defaultWidth) width = defaultWidth
  if (height < defaultHeight) height = defaultHeight
  return [width, height + 20]
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
            reactFlowViewport: canonicalRungViewport(rung),
            nodes: Array.isArray(rung.nodes)
              ? (rung.nodes as Array<Record<string, unknown>>).map(sanitizeGraphicalNode)
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
              ? (rung.nodes as Array<Record<string, unknown>>).map(sanitizeGraphicalNode)
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
