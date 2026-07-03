/**
 * Debug Polling Filter
 *
 * Builds the set of debug indexes that should be polled each tick,
 * filtering to only variables that are actively needed:
 *
 * 1. Watched variables (debug === true in POU declaration)
 * 2. Forced variables (currently forced, must stay polled)
 * 3. Graph-listed variables (being plotted in real-time charts)
 * 4. Diagram-visible variables (LD/FBD contacts, coils, variable nodes, block outputs)
 * 5. Source-visible variables (ST/IL — regex-matched against source text)
 * 6. Expanded nested children (only when parent hierarchy is expanded)
 *
 * Diagram/source scan results are cached per {pouName, language, fbContext}
 * since the editor is read-only during debug — no recomputation needed
 * unless the user switches tabs or FB instance selection.
 */

import type { FbInstanceInfo, PLCPou } from '../../middleware/shared/ports/types'

/**
 * Minimal state shape required by the debug polling filter.
 * Defined locally to avoid coupling the utils layer to the store layer.
 */
export interface DebugPollingState {
  project: { data: { pous: PLCPou[] } }
  workspace: {
    debugVariableIndexes: Map<string, number>
    debugForcedVariables: Map<string, unknown>
    debugExpandedNodes: Map<string, boolean>
    debugGraphList: string[]
    fbSelectedInstance: Map<string, string>
    fbDebugInstances: Map<string, FbInstanceInfo[]>
  }
  editor: { meta: { name: string; [key: string]: unknown } }
  ladderFlows: Array<{
    name: string
    rungs: Array<{ nodes: Array<{ type?: string; data: unknown }> }>
  }>
  fbdFlows: Array<{
    name: string
    rung: { nodes: Array<{ type?: string; data: unknown }> }
  }>
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VisibleVarsCache = {
  pouName: string
  language: string
  fbContextKey: string
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

  const { pous } = state.project.data
  const {
    debugVariableIndexes,
    debugForcedVariables,
    debugExpandedNodes,
    debugGraphList,
    fbSelectedInstance,
    fbDebugInstances,
  } = state.workspace
  const { editor } = state

  // -----------------------------------------------------------------------
  // 1. Watched variables (debug === true)
  // -----------------------------------------------------------------------
  for (const pou of pous) {
    const variables = pou.interface?.variables ?? []
    const watched = variables.filter((v) => v.debug === true)
    if (watched.length === 0) continue

    if (pou.pouType === 'function-block') {
      const resolved = resolveFbInstance(pou.name, fbSelectedInstance, fbDebugInstances)
      if (!resolved) continue
      for (const v of watched) {
        activeKeys.add(`${resolved.programName}:${resolved.fbVariableName}.${v.name}`)
      }
    } else {
      for (const v of watched) {
        activeKeys.add(`${pou.name}:${v.name}`)
      }
    }
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
  // 4. Expanded nested children
  //    Walk all leaves whose compositeKey is a child of some other variable
  //    — either a struct/FB field (`.field`) or an array element (`[idx]`)
  //    — and include them if they have a watched/forced/graphed ancestor
  //    AND every node in the hierarchy from that ancestor down is expanded.
  // -----------------------------------------------------------------------
  for (const [, metas] of allLeaves) {
    for (const meta of metas) {
      const key = meta.compositeKey
      const colonIdx = key.indexOf(':')
      if (colonIdx === -1) continue
      const pouName = key.slice(0, colonIdx)
      const varName = key.slice(colonIdx + 1)
      // Only nested leaves (struct fields, FB fields, array elements) need
      // ancestor-resolution; flat leaves are handled by the watched-key path.
      if (!varName.includes('.') && !varName.includes('[')) continue

      if (shouldPollNestedVariable(varName, pouName, activeKeys, debugExpandedNodes, debugGraphList)) {
        activeKeys.add(key)
      }
    }
  }

  // -----------------------------------------------------------------------
  // 5 & 6. Diagram-visible / Source-visible variables (cached)
  // -----------------------------------------------------------------------
  const editorName = editor.meta.name
  const editorLanguage = 'language' in editor.meta ? (editor.meta.language as string) : ''
  const currentPou = pous.find((p) => p.name === editorName)

  if (currentPou) {
    const fbCtxKey =
      currentPou.pouType === 'function-block' ? (fbSelectedInstance.get(currentPou.name.toUpperCase()) ?? '') : ''

    // Check if cache is still valid
    if (
      cachedResult &&
      cachedResult.pouName === editorName &&
      cachedResult.language === editorLanguage &&
      cachedResult.fbContextKey === fbCtxKey
    ) {
      for (const k of cachedResult.keys) activeKeys.add(k)
    } else {
      const visibleKeys = computeVisibleVariableKeys(state, currentPou, allLeaves)
      cachedResult = { pouName: editorName, language: editorLanguage, fbContextKey: fbCtxKey, keys: visibleKeys }
      for (const k of visibleKeys) activeKeys.add(k)
    }
  }

  // -----------------------------------------------------------------------
  // Resolve composite keys → debug indexes
  // -----------------------------------------------------------------------
  const indexSet = new Set<number>()
  for (const key of activeKeys) {
    const idx = debugVariableIndexes.get(key)
    if (idx !== undefined) {
      indexSet.add(idx)
    }
  }

  // Also include by scanning allLeaves (handles cases where debugVariableIndexes
  // doesn't have the key but the tree does, e.g. deeply nested fields). One
  // index can carry several keys (shared globals) — active if ANY is active.
  for (const [index, metas] of allLeaves) {
    if (metas.some((m) => activeKeys.has(m.compositeKey))) {
      indexSet.add(index)
    }
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

/**
 * Determine if a nested variable (contains '.') should be polled.
 *
 * A nested variable is polled if:
 * - It's in the graph list (for real-time plotting), OR
 * - It has a watched/forced/graphed ancestor AND all nodes from that
 *   ancestor to this variable are expanded in the debugger panel
 */
/**
 * Yield the proper-prefix ancestor paths of a variable, treating both
 * `.` (struct/FB field) and `[` (array element) as ancestor boundaries.
 *
 *   "MY_ARRAY[1]"      → ["MY_ARRAY"]
 *   "FB.NESTED[2]"     → ["FB", "FB.NESTED"]
 *   "FB.STRUCT.FIELD"  → ["FB", "FB.STRUCT"]
 *
 * The shallowest ancestor comes first; the variable itself is not yielded.
 */
function ancestorPaths(varName: string): string[] {
  const result: string[] = []
  for (let i = 1; i < varName.length; i++) {
    if (varName[i] === '.' || varName[i] === '[') {
      result.push(varName.slice(0, i))
    }
  }
  return result
}

function shouldPollNestedVariable(
  varName: string,
  pouName: string,
  watchedKeys: Set<string>,
  debugExpandedNodes: Map<string, boolean>,
  debugGraphList: string[],
): boolean {
  const compositeKey = `${pouName}:${varName}`

  // Graph-listed → always poll
  if (debugGraphList.includes(compositeKey)) return true

  const ancestors = ancestorPaths(varName)
  /* istanbul ignore next -- defensive: caller already checks for '.' or '[' */
  if (ancestors.length === 0) return true

  // Find the deepest watched ancestor
  let watchedAncestorIndex = -1
  for (let i = ancestors.length - 1; i >= 0; i--) {
    if (watchedKeys.has(`${pouName}:${ancestors[i]}`)) {
      watchedAncestorIndex = i
      break
    }
  }

  if (watchedAncestorIndex === -1) return false

  // Check that every node from the watched ancestor down to (but not
  // including) the leaf is expanded. For arrays, the array root is the
  // only intermediate node; for struct/FB fields, every parent in the
  // chain must be expanded.
  for (let i = watchedAncestorIndex; i < ancestors.length; i++) {
    if (!(debugExpandedNodes.get(`${pouName}:${ancestors[i]}`) ?? false)) {
      return false
    }
  }

  return true
}

/**
 * Compute the set of composite keys visible on the active diagram (LD/FBD)
 * or referenced in source text (ST/IL). This result is cached.
 */
function computeVisibleVariableKeys(
  state: DebugPollingState,
  currentPou: PLCPou,
  allLeaves: Map<number, { compositeKey: string; type: string }[]>,
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

  if (language === 'ld') {
    collectLdVisibleKeys(state, makeKey, addLeavesWithPrefix, keys)
  } else if (language === 'fbd') {
    collectFbdVisibleKeys(state, makeKey, addLeavesWithPrefix, keys)
  } else if (language === 'st' || language === 'il') {
    collectStIlVisibleKeys(currentPou, makeKey, addLeavesWithPrefix, keys)
  }

  return keys
}

/**
 * Collect composite keys for variables visible on a Ladder Diagram.
 */
function collectLdVisibleKeys(
  state: DebugPollingState,
  makeKey: (name: string) => string | null,
  addLeavesWithPrefix: (prefix: string) => void,
  keys: Set<string>,
): void {
  const editorName = state.editor.meta.name
  const currentFlow = state.ladderFlows.find((f) => f.name === editorName)
  if (!currentFlow) return

  for (const rung of currentFlow.rungs) {
    for (const node of rung.nodes) {
      if (node.type === 'contact' || node.type === 'coil') {
        const nodeData = node.data as { variable?: { name?: string } }
        const varName = nodeData.variable?.name
        if (varName) {
          const key = makeKey(varName)
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
 * Collect composite keys for variables visible on a Function Block Diagram.
 */
function collectFbdVisibleKeys(
  state: DebugPollingState,
  makeKey: (name: string) => string | null,
  addLeavesWithPrefix: (prefix: string) => void,
  keys: Set<string>,
): void {
  const editorName = state.editor.meta.name
  const currentFlow = state.fbdFlows.find((f) => f.name === editorName)
  if (!currentFlow) return

  for (const node of currentFlow.rung.nodes) {
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
 * Regex-matches each declared variable name against the source body.
 * Also includes FB instance sub-variables when the instance name appears
 * in the source text.
 */
function collectStIlVisibleKeys(
  currentPou: PLCPou,
  makeKey: (name: string) => string | null,
  addLeavesWithPrefix: (prefix: string) => void,
  keys: Set<string>,
): void {
  const sourceText = typeof currentPou.body.value === 'string' ? currentPou.body.value : ''
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
