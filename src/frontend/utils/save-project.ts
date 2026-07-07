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
