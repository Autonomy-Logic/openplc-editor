/**
 * Shared debugger session helpers.
 *
 * Builds the debug variable index map, debug tree, and FB instance map
 * from STruC++'s debug-map.json and the project structure. The artifacts
 * are stored in the workspace Zustand store for the debugger UI.
 */

import type { SystemLibrary } from '../../middleware/shared/ports/library-types'
import type {
  DebugTreeNode,
  FbInstanceInfo,
  PLCDataType,
  PLCInstance,
  PLCPou,
  PLCVariable,
} from '../../middleware/shared/ports/types'
import type { DebugMap, DebugVariableEntry } from './debug-parser'
import { packDebugAddr } from './debug-parser'
import { buildDebugTree } from './debug-tree-builder'
import { buildDebugPathPrefix, findInstanceName, type PLCInstanceMapping } from './debug-variable-finder'

// ---------------------------------------------------------------------------
// 0. logCompilerEvent — shared log helper for compile/debug progress
// ---------------------------------------------------------------------------

/**
 * Forward compile/debug progress lines to the console log.
 *
 * Plain progress messages get split on newlines into one log entry
 * per line — keeps the existing scroll/wrap/copy behaviour intact for
 * the long Arduino-CLI / xml2st outputs.
 *
 * Events that carry a structured `compileError` are emitted as a
 * single multi-line entry instead, with the structured field attached.
 * The renderer's LogComponent uses `whitespace-pre-wrap` so the
 * gcc-style snippet still displays correctly, and the bracketed POU
 * prefix on the first line becomes a clickable affordance backed by
 * the carried strucpp diagnostic.
 */
export function logCompilerEvent(
  event: {
    message?: string
    level?: string
    compileError?: import('../../middleware/shared/ports/types').StructuredCompileError
  },
  log: (entry: {
    id: string
    level: 'error' | 'debug' | 'info' | 'warning'
    message: string
    compileError?: import('../../middleware/shared/ports/types').StructuredCompileError
  }) => void,
): void {
  if (!event.message) return
  const level = (event.level as 'error' | 'debug' | 'info' | 'warning') ?? 'info'

  if (event.compileError) {
    log({
      id: crypto.randomUUID(),
      level,
      message: event.message.trim(),
      compileError: event.compileError,
    })
    return
  }

  event.message
    .trim()
    .split('\n')
    .forEach((line) => {
      if (line) {
        log({
          id: crypto.randomUUID(),
          level,
          message: line,
        })
      }
    })
}

// ---------------------------------------------------------------------------
// 1. deriveVariableIndexMap — composite-key -> packed-DebugAddr (from the tree)
// ---------------------------------------------------------------------------

/**
 * Derive the composite-key -> packed-DebugAddr map from the debug tree, which
 * is the single enumeration walk (`traverseVariable`, via
 * `buildDebugVariableTreeMap`).
 *
 * The tree already resolved every variable's debug address exactly once,
 * applying the one path convention (external globals by their bare name,
 * program-locals instance-prefixed, `.FIELD` for struct/FB fields, `[idx]` for
 * array elements). Flattening its leaves here guarantees the LD/FBD editors,
 * the watch panel, and the poller all address a variable identically — there is
 * no second walk that can drift. (A divergent inline walk here is exactly how
 * force silently no-op'd on located globals: it missed the external case.)
 *
 * Addresses are (arrayIdx, elemIdx) pairs packed into a single number
 * `(arr << 16) | elem`. `treeMap` is the flat compositeKey -> node map that
 * `buildDebugVariableTreeMap` returns (every node, nested included).
 */
export function deriveVariableIndexMap(treeMap: Map<string, DebugTreeNode>, map: DebugMap): Map<string, number> {
  const indexMap = new Map<string, number>()

  // Every resolved leaf in the tree, keyed by its composite key. Complex nodes
  // (structs / FBs / arrays) carry no address of their own — only their leaves
  // do (debugIndex === undefined on the parents).
  for (const [compositeKey, node] of treeMap) {
    if (node.debugIndex !== undefined) {
      indexMap.set(compositeKey, node.debugIndex)
    }
  }

  // Fallback: also key by the raw debug path so any leaves the tree didn't
  // surface (e.g. library-FB internals) remain reachable by path.
  for (const leaf of map.leaves) {
    if (!indexMap.has(leaf.path)) {
      indexMap.set(leaf.path, packDebugAddr(leaf))
    }
  }

  return indexMap
}

/**
 * Flatten a DebugMap's leaves into the DebugVariableEntry[] shape the tree
 * builder consumes. `index` carries the packed (arr<<16|elem) address.
 */
export function debugMapToEntries(map: DebugMap): DebugVariableEntry[] {
  return map.leaves.map((leaf) => ({
    name: leaf.path,
    type: `${leaf.type}_ENUM`,
    index: packDebugAddr(leaf),
  }))
}

// ---------------------------------------------------------------------------
// 2. buildDebugVariableTreeMap
// ---------------------------------------------------------------------------

export interface DebugVariableTreeMapResult {
  treeMap: Map<string, DebugTreeNode>
  trees: DebugTreeNode[]
  complexCount: number
  warnings: string[]
}

/**
 * Build a flat compositeKey -> DebugTreeNode map by traversing all program
 * POU variables. This is the single enumeration walk (`traverseVariable`);
 * `deriveVariableIndexMap` and the poller's leaf collection both project off
 * its output rather than re-walking. Pure function — swallows per-variable
 * errors to match existing behaviour; `warnings` collects programs with no
 * instance in Resources (same diagnostic the old index-map walk emitted).
 */
export function buildDebugVariableTreeMap(
  pous: PLCPou[],
  instances: PLCInstance[],
  debugVariables: DebugVariableEntry[],
  projectData: { dataTypes: PLCDataType[]; pous: PLCPou[] },
  systemLibraries: SystemLibrary[],
): DebugVariableTreeMapResult {
  const trees: DebugTreeNode[] = []
  const treeMap = new Map<string, DebugTreeNode>()
  const warnings: string[] = []
  let complexCount = 0

  const instanceMappings: PLCInstanceMapping[] = instances.map((inst) => ({
    name: inst.name,
    program: inst.program,
  }))

  const addNodeAndChildrenToMap = (node: DebugTreeNode) => {
    treeMap.set(node.compositeKey, node)
    if (node.children) {
      for (const child of node.children) {
        addNodeAndChildrenToMap(child)
      }
    }
  }

  pous.forEach((pou) => {
    if (pou.pouType !== 'program') return

    const instanceName = findInstanceName(pou.name, instanceMappings)
    if (!instanceName) {
      warnings.push(`No instance found for program '${pou.name}', skipping debug variable parsing.`)
      return
    }

    const variables = pou.interface?.variables ?? []
    variables.forEach((v: PLCVariable) => {
      try {
        const node = buildDebugTree(v, pou.name, instanceName, debugVariables, projectData, systemLibraries)
        trees.push(node)
        addNodeAndChildrenToMap(node)
        if (node.isComplex) {
          complexCount++
        }
      } catch {
        // Tree building failed for this variable — swallow to match existing behaviour
      }
    })

    // Add compiler-generated _TMP_ variables for painting block output edges
    const instancePrefix = buildDebugPathPrefix(instanceName) + '.'
    for (const dv of debugVariables) {
      if (!dv.name.startsWith(instancePrefix)) continue
      const localName = dv.name.slice(instancePrefix.length)
      if (!localName.startsWith('_TMP_')) continue

      let typeName = dv.type
      if (typeName.endsWith('_O_ENUM') || typeName.endsWith('_P_ENUM')) {
        typeName = typeName.replace(/_(O|P)_ENUM$/, '')
      } else if (typeName.endsWith('_ENUM')) {
        typeName = typeName.replace(/_ENUM$/, '')
      }

      const node: DebugTreeNode = {
        name: localName,
        fullPath: dv.name,
        compositeKey: `${pou.name}:${localName}`,
        type: typeName,
        isComplex: false,
        debugIndex: dv.index,
      }
      trees.push(node)
      addNodeAndChildrenToMap(node)
    }
  })

  return { treeMap, trees, complexCount, warnings }
}

// ---------------------------------------------------------------------------
// 3. buildFbInstanceMap
// ---------------------------------------------------------------------------

/**
 * Build a map of FB type name (uppercased) -> FbInstanceInfo[] for all
 * derived-type variables that are function blocks.
 */
export function buildFbInstanceMap(pous: PLCPou[], instances: PLCInstance[]): Map<string, FbInstanceInfo[]> {
  const fbDebugInstancesMap = new Map<string, FbInstanceInfo[]>()

  const instanceMappings: PLCInstanceMapping[] = instances.map((inst) => ({
    name: inst.name,
    program: inst.program,
  }))

  pous.forEach((pou) => {
    if (pou.pouType !== 'program') return

    const instanceName = findInstanceName(pou.name, instanceMappings)
    if (!instanceName) return

    const variables = pou.interface?.variables ?? []
    variables.forEach((v: PLCVariable) => {
      if (v.type.definition !== 'derived') return

      const fbTypeNameRaw = v.type.value
      const fbTypeKey = fbTypeNameRaw.toUpperCase()

      const isCustomFB = pous.some((p) => p.pouType === 'function-block' && p.name.toUpperCase() === fbTypeKey)

      // Accept derived types as FB instances if they are custom FBs or match any POU
      if (isCustomFB) {
        const instanceInfo: FbInstanceInfo = {
          fbTypeName: fbTypeNameRaw,
          programName: pou.name,
          programInstanceName: instanceName,
          fbVariableName: v.name,
          key: `${pou.name}:${v.name}`,
        }

        const existingInstances = fbDebugInstancesMap.get(fbTypeKey) || []
        existingInstances.push(instanceInfo)
        fbDebugInstancesMap.set(fbTypeKey, existingInstances)
      }
    })
  })

  return fbDebugInstancesMap
}
