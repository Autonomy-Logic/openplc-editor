/**
 * Debug Polling Filter
 *
 * Builds the set of debug indexes that should be polled each tick,
 * filtering to only variables that are actively needed:
 *
 * 1. Debugger panel rows on screen (watched and forced roots, expanded children)
 * 2. Forced variables (currently forced, must stay polled)
 * 3. Graph-listed variables (being plotted in real-time charts)
 * 4. Diagram-visible variables (contacts, coils, variables and block outputs of the LD rungs
 *    or FBD nodes on screen)
 * 5. Source-visible variables (ST/IL — regex-matched against the lines on screen)
 *
 * Diagram/source scan results are cached per {pouName, language, fbContext, viewKey}
 * since the editor is read-only during debug — no recomputation needed
 * unless the user switches tabs, FB instance selection or scrolls/resizes the editor.
 */

import type { FbInstanceInfo, PLCPou } from '../../middleware/shared/ports/types'
import { edgeTriggerInstanceName, edgeTriggerTypeForVariant } from './PLC/edge-trigger-instance'

/**
 * Minimal state shape required by the debug polling filter.
 * Defined locally to avoid coupling the utils layer to the store layer.
 */
export interface DebugPollingState {
  project: { data: { pous: PLCPou[] } }
  workspace: {
    debugVariableIndexes: Map<string, number>
    debugForcedVariables: Map<string, unknown>
    debugPanelVisibleKeys: string[]
    debugEditorViewport: DebugViewport | null
    debugGraphList: string[]
    fbSelectedInstance: Map<string, string>
    fbDebugInstances: Map<string, FbInstanceInfo[]>
    /** Generated program the session is running, when it runs one the
     *  project does not contain — see the workspace slice. */
    debugHarness: { programPou: PLCPou } | null
  }
  editor: { meta: { name: string; [key: string]: unknown } }
  ladderFlows: Array<{
    name: string
    rungs: Array<{ id: string; nodes: Array<{ type?: string; data: unknown }> }>
  }>
  fbdFlows: Array<{
    name: string
    rung: { nodes: Array<{ id: string; type?: string; data: unknown }> }
  }>
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Part of the active POU editor on screen: line ranges (ST/IL) or element ids (LD rungs, FBD nodes). */
export type DebugViewport = { pouName: string; lines?: Array<[number, number]>; elementIds?: string[] }

export type VisibleVarsCache = {
  pouName: string
  language: string
  fbContextKey: string
  viewKey: string
  keys: Set<string>
} | null

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a sorted array of debug indexes to poll this tick.
 *
 * @param state        - Current Zustand store snapshot
 * @param allLeaves    - Full index→{compositeKey,type}[] map (all debug tree
 *                       leaves; one index maps to many leaves for shared globals)
 * @param cachedResult - Previous diagram/source scan cache (or null)
 * @returns activeIndexes (sorted) and updated cache
 */
export function buildActiveIndexSet(
  state: DebugPollingState,
  allLeaves: Map<number, { compositeKey: string; type: string }[]>,
  cachedResult: VisibleVarsCache,
): { activeIndexes: number[]; cacheResult: VisibleVarsCache } {
  const activeKeys = new Set<string>()

  const { debugVariableIndexes, debugForcedVariables, debugPanelVisibleKeys, debugGraphList, debugHarness } =
    state.workspace
  const pous = debugHarness ? [...state.project.data.pous, debugHarness.programPou] : state.project.data.pous
  const { editor } = state
  const { fbSelectedInstance } = state.workspace

  // -----------------------------------------------------------------------
  // 1. Debugger panel rows on screen
  // -----------------------------------------------------------------------
  for (const compositeKey of debugPanelVisibleKeys) {
    activeKeys.add(compositeKey)
  }

  // -----------------------------------------------------------------------
  // 2. Forced variables
  // -----------------------------------------------------------------------
  for (const compositeKey of debugForcedVariables.keys()) {
    activeKeys.add(compositeKey)
  }

  // -----------------------------------------------------------------------
  // 3. Graph-listed variables
  // -----------------------------------------------------------------------
  for (const compositeKey of debugGraphList) {
    activeKeys.add(compositeKey)
  }

  // -----------------------------------------------------------------------
  // 4 & 5. Diagram-visible / Source-visible variables (cached)
  // -----------------------------------------------------------------------
  const editorName = editor.meta.name
  const editorLanguage = 'language' in editor.meta ? (editor.meta.language as string) : ''
  const currentPou = pous.find((p) => p.name === editorName)

  if (currentPou) {
    const fbCtxKey =
      currentPou.pouType === 'function-block' ? (fbSelectedInstance.get(currentPou.name.toUpperCase()) ?? '') : ''

    const viewport = viewportFor(state, currentPou)
    const viewKey = viewport ? debugViewportKey(viewport) : ''

    // Check if cache is still valid
    if (
      cachedResult &&
      cachedResult.pouName === editorName &&
      cachedResult.language === editorLanguage &&
      cachedResult.fbContextKey === fbCtxKey &&
      cachedResult.viewKey === viewKey
    ) {
      for (const k of cachedResult.keys) activeKeys.add(k)
    } else {
      const visibleKeys = computeVisibleVariableKeys(state, currentPou, allLeaves, viewport)
      cachedResult = {
        pouName: editorName,
        language: editorLanguage,
        fbContextKey: fbCtxKey,
        viewKey,
        keys: visibleKeys,
      }
      for (const k of visibleKeys) activeKeys.add(k)
    }
  }

  // -----------------------------------------------------------------------
  // Resolve composite keys → debug indexes
  // -----------------------------------------------------------------------
  const indexSet = new Set<number>()
  const leafIndexes = leafIndexByKey(allLeaves)
  for (const key of activeKeys) {
    const idx = debugVariableIndexes.get(key)
    if (idx !== undefined) indexSet.add(idx)
    for (const leafIdx of leafIndexes.get(key) ?? []) indexSet.add(leafIdx)
  }

  const activeIndexes = Array.from(indexSet).sort((a, b) => a - b)
  return { activeIndexes, cacheResult: cachedResult }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the selected FB instance for a function-block POU type.
 */
function resolveFbInstance(
  pouName: string,
  fbSelectedInstance: Map<string, string>,
  fbDebugInstances: Map<string, FbInstanceInfo[]>,
): FbInstanceInfo | null {
  const fbTypeKey = pouName.toUpperCase()
  const selectedKey = fbSelectedInstance.get(fbTypeKey)
  if (!selectedKey) return null
  const instances = fbDebugInstances.get(fbTypeKey) ?? []
  return instances.find((inst) => inst.key === selectedKey) ?? null
}

/** Viewport the active editor reports for this POU in the form its language uses; null scans the whole POU. */
function viewportFor(state: DebugPollingState, currentPou: PLCPou): DebugViewport | null {
  const viewport = state.workspace.debugEditorViewport
  if (!viewport || viewport.pouName !== currentPou.name) return null
  const language = currentPou.body.language
  if (language === 'st' || language === 'il') return viewport.lines ? viewport : null
  if (language === 'ld' || language === 'fbd') return viewport.elementIds ? viewport : null
  return null
}

/** Identity of a viewport's content; equal keys poll the same variables. */
export function debugViewportKey(viewport: DebugViewport): string {
  const lines = viewport.lines?.map(([from, to]) => `${from}-${to}`).join(',') ?? ''
  return `${viewport.pouName}|${lines}|${viewport.elementIds?.join(',') ?? ''}`
}

/** Composite key → debug indexes of the leaves carrying it, built once per leaf map. */
const leafIndexCache = new WeakMap<Map<number, { compositeKey: string }[]>, Map<string, number[]>>()

function leafIndexByKey(allLeaves: Map<number, { compositeKey: string }[]>): Map<string, number[]> {
  const cached = leafIndexCache.get(allLeaves)
  if (cached) return cached
  const byKey = new Map<string, number[]>()
  for (const [index, metas] of allLeaves) {
    for (const meta of metas) {
      const indexes = byKey.get(meta.compositeKey)
      if (indexes) indexes.push(index)
      else byKey.set(meta.compositeKey, [index])
    }
  }
  leafIndexCache.set(allLeaves, byKey)
  return byKey
}

/**
 * Compute the set of composite keys visible on the active diagram (LD/FBD)
 * or referenced in source text (ST/IL). This result is cached.
 */
function computeVisibleVariableKeys(
  state: DebugPollingState,
  currentPou: PLCPou,
  allLeaves: Map<number, { compositeKey: string; type: string }[]>,
  viewport: DebugViewport | null,
): Set<string> {
  const keys = new Set<string>()
  const language = currentPou.body.language
  const {
    workspace: { fbSelectedInstance, fbDebugInstances },
  } = state

  // Helper to make composite key respecting FB instance context
  const makeKey = (variableName: string): string | null => {
    if (currentPou.pouType === 'function-block') {
      const resolved = resolveFbInstance(currentPou.name, fbSelectedInstance, fbDebugInstances)
      if (!resolved) return null
      return `${resolved.programName}:${resolved.fbVariableName}.${variableName}`
    }
    return `${currentPou.name}:${variableName}`
  }

  // Helper to find all leaf keys matching a prefix in the debug tree
  const addLeavesWithPrefix = (prefix: string) => {
    for (const [, metas] of allLeaves) {
      for (const meta of metas) {
        if (meta.compositeKey.startsWith(prefix)) {
          keys.add(meta.compositeKey)
        }
      }
    }
  }

  const elementIds = viewport?.elementIds ? new Set(viewport.elementIds) : null
  if (language === 'ld') {
    collectLdVisibleKeys(state, elementIds, makeKey, addLeavesWithPrefix, keys)
  } else if (language === 'fbd') {
    collectFbdVisibleKeys(state, elementIds, makeKey, addLeavesWithPrefix, keys)
  } else if (language === 'st' || language === 'il') {
    collectStIlVisibleKeys(currentPou, viewport?.lines ?? null, makeKey, addLeavesWithPrefix, keys)
  }

  return keys
}

/**
 * Collect composite keys for variables on the rungs on screen of a Ladder Diagram,
 * or on every rung when `rungIds` is null.
 */
function collectLdVisibleKeys(
  state: DebugPollingState,
  rungIds: Set<string> | null,
  makeKey: (name: string) => string | null,
  addLeavesWithPrefix: (prefix: string) => void,
  keys: Set<string>,
): void {
  const editorName = state.editor.meta.name
  const currentFlow = state.ladderFlows.find((f) => f.name === editorName)
  if (!currentFlow) return

  for (const rung of currentFlow.rungs) {
    if (rungIds && !rungIds.has(rung.id)) continue
    for (const node of rung.nodes) {
      if (node.type === 'contact' || node.type === 'coil') {
        const nodeData = node.data as { variable?: { name?: string }; variant?: string; numericId?: string }
        const varName = nodeData.variable?.name
        if (varName) {
          const key = makeKey(varName)
          if (key) keys.add(key)
        }
        const edgeTriggerType = node.type === 'contact' ? edgeTriggerTypeForVariant(nodeData.variant ?? '') : null
        const edgeTriggerName = edgeTriggerType ? edgeTriggerInstanceName(edgeTriggerType, nodeData.numericId) : null
        if (edgeTriggerName) {
          const key = makeKey(`${edgeTriggerName}.Q`)
          if (key) keys.add(key)
        }
      } else if (node.type === 'variable') {
        const nodeData = node.data as { variable?: { name?: string } }
        const varName = nodeData.variable?.name
        if (varName) {
          const key = makeKey(varName)
          if (key) keys.add(key)
        }
      } else if (node.type === 'block') {
        collectBlockOutputKeys(node, makeKey, addLeavesWithPrefix)
      }
    }
  }
}

/**
 * Collect composite keys for variables of the given nodes of a Function Block Diagram,
 * or of every node when `nodeIds` is null.
 */
function collectFbdVisibleKeys(
  state: DebugPollingState,
  nodeIds: Set<string> | null,
  makeKey: (name: string) => string | null,
  addLeavesWithPrefix: (prefix: string) => void,
  keys: Set<string>,
): void {
  const editorName = state.editor.meta.name
  const currentFlow = state.fbdFlows.find((f) => f.name === editorName)
  if (!currentFlow) return

  for (const node of currentFlow.rung.nodes) {
    if (nodeIds && !nodeIds.has(node.id)) continue
    if (node.type === 'input-variable' || node.type === 'output-variable' || node.type === 'inout-variable') {
      const nodeData = node.data as { variable?: { name?: string } }
      const varName = nodeData.variable?.name
      if (varName) {
        const key = makeKey(varName)
        if (key) keys.add(key)
      }
    } else if (node.type === 'block') {
      collectBlockOutputKeys(node, makeKey, addLeavesWithPrefix)
    }
  }
}

/**
 * Collect composite keys for block output variables (shared by LD and FBD).
 *
 * For function-block instances: polls all sub-variables (e.g., TON0.ET, TON0.Q)
 * For function calls: polls compiler-generated _TMP_ output variables
 */
function collectBlockOutputKeys(
  node: { data: unknown },
  makeKey: (name: string) => string | null,
  addLeavesWithPrefix: (prefix: string) => void,
): void {
  const blockData = node.data as {
    variant?: { name: string; type: string; variables?: { name: string; class: string }[] }
    variable?: { name?: string }
    numericId?: string
  }

  if (!blockData.variant) return

  const instanceName = blockData.variable?.name
  const blockType = blockData.variant.type

  if (blockType === 'function-block' && instanceName) {
    // Poll all sub-variables of this FB instance (e.g., TON0.ET, TON0.Q)
    const prefix = makeKey(`${instanceName}.`)
    if (prefix) addLeavesWithPrefix(prefix)
  } else if (blockType === 'function' && blockData.numericId) {
    // Poll compiler-generated _TMP_ variables for function outputs
    // Pattern: _TMP_FUNCNAME<numericId>_OUTNAME
    const funcName = blockData.variant.name
    const tmpPrefix = makeKey(`_TMP_${funcName}${blockData.numericId}_`)
    if (tmpPrefix) addLeavesWithPrefix(tmpPrefix)
  }
}

/**
 * Collect composite keys for variables referenced in ST/IL source text.
 *
 * Regex-matches each declared variable name against the visible lines of the
 * source body, or the whole body when no line ranges are given.
 * Also includes FB instance sub-variables when the instance name appears
 * in the source text.
 */
function collectStIlVisibleKeys(
  currentPou: PLCPou,
  visibleLines: Array<[number, number]> | null,
  makeKey: (name: string) => string | null,
  addLeavesWithPrefix: (prefix: string) => void,
  keys: Set<string>,
): void {
  const body = typeof currentPou.body.value === 'string' ? currentPou.body.value : ''
  const sourceText = visibleLines ? sliceLines(body, visibleLines) : body
  if (!sourceText) return

  const variables = currentPou.interface?.variables ?? []

  for (const v of variables) {
    // Escape regex special characters in variable name
    const escaped = v.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(`\\b${escaped}\\b`, 'i')

    if (pattern.test(sourceText)) {
      const key = makeKey(v.name)
      if (key) {
        keys.add(key)

        // For derived-type variables (FB instances), also poll sub-variables
        if (v.type.definition === 'derived') {
          const prefix = makeKey(`${v.name}.`)
          /* istanbul ignore next -- defensive: makeKey consistency within same call */
          if (prefix) addLeavesWithPrefix(prefix)
        }
      }
    }
  }
}

/** Text of the given 1-based inclusive line ranges, one line per row. */
function sliceLines(text: string, ranges: Array<[number, number]>): string {
  const lines = text.split(/\r\n|\r|\n/)
  const picked: string[] = []
  for (const [from, to] of ranges) {
    for (let line = Math.max(1, from); line <= Math.min(lines.length, to); line++) picked.push(lines[line - 1])
  }
  return picked.join('\n')
}
