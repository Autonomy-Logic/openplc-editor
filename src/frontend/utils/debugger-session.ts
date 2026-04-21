/**
 * Shared debugger session helpers.
 *
 * Builds the debug variable index map, debug tree, and FB instance map
 * from STruC++'s debug-map.json and the project structure. The artifacts
 * are stored in the workspace Zustand store for the debugger UI.
 */

import type {
  DebugTreeNode,
  FbInstanceInfo,
  PLCDataType,
  PLCInstance,
  PLCPou,
  PLCVariable,
} from '../../middleware/shared/ports/types'
import type { DebugMapV2, DebugVariableEntry } from './debug-parser'
import { packDebugAddr } from './debug-parser'
import { buildDebugTree } from './debug-tree-builder'
import { buildDebugPathPrefix, findInstanceName, type PLCInstanceMapping } from './debug-variable-finder'

// ---------------------------------------------------------------------------
// 0. logCompilerEvent — shared log helper for compile/debug progress
// ---------------------------------------------------------------------------

/** Forward compile/debug progress lines to the console log. */
export function logCompilerEvent(
  event: { message?: string; level?: string },
  log: (entry: { id: string; level: 'error' | 'debug' | 'info' | 'warning'; message: string }) => void,
): void {
  if (!event.message) return
  event.message
    .trim()
    .split('\n')
    .forEach((line) => {
      if (line) {
        log({
          id: crypto.randomUUID(),
          level: (event.level as 'error' | 'debug' | 'info' | 'warning') ?? 'info',
          message: line,
        })
      }
    })
}

// ---------------------------------------------------------------------------
// 1. buildVariableIndexMapV2 — composite-key -> packed-DebugAddr
// ---------------------------------------------------------------------------

export interface VariableIndexMapResult {
  indexMap: Map<string, number>
  warnings: string[]
}

/**
 * Build a composite-key -> packed-DebugAddr map from a v2 DebugMap.
 *
 * The v2 map addresses variables as (arrayIdx, elemIdx) pairs; we pack those
 * into a single number `(arr << 16) | elem` so downstream store types and
 * the polling loop see a plain `number` key.
 *
 * Path convention emitted by STruC++:
 *   INSTANCE_NAME.VAR_NAME            (scalar)
 *   INSTANCE_NAME.VAR_NAME[5]         (array element, IEC-indexed)
 *   INSTANCE_NAME.FB_INST.FIELD       (nested struct/FB field)
 */
export function buildVariableIndexMapV2(
  pous: PLCPou[],
  instances: PLCInstance[],
  map: DebugMapV2,
): VariableIndexMapResult {
  const indexMap = new Map<string, number>()
  const warnings: string[] = []

  // Build a path -> packed-address lookup (case-insensitive).
  const pathToAddr = new Map<string, number>()
  for (const leaf of map.leaves) {
    pathToAddr.set(leaf.path.toUpperCase(), packDebugAddr(leaf))
  }

  const instanceMappings: PLCInstanceMapping[] = instances.map((inst) => ({
    name: inst.name,
    program: inst.program,
  }))

  pous.forEach((pou) => {
    if (pou.pouType !== 'program') return

    const instanceName = findInstanceName(pou.name, instanceMappings)
    if (!instanceName) {
      warnings.push(`No instance found for program '${pou.name}', skipping debug variable parsing.`)
      return
    }

    const upperInstance = instanceName.toUpperCase()
    const variables = pou.interface?.variables ?? []

    variables.forEach((v: PLCVariable) => {
      if (v.type.definition === 'array' && v.type.data) {
        const dimensions = v.type.data.dimensions
        if (dimensions.length > 0) {
          const dimMatch = dimensions[0].dimension.match(/^(-?\d+)\.\.(-?\d+)$/)
          if (dimMatch) {
            const startIdx = parseInt(dimMatch[1], 10)
            const endIdx = parseInt(dimMatch[2], 10)
            for (let i = 0; i <= endIdx - startIdx; i++) {
              const iecIdx = startIdx + i
              const path = `${upperInstance}.${v.name.toUpperCase()}[${iecIdx}]`
              const addr = pathToAddr.get(path)
              if (addr !== undefined) {
                indexMap.set(`${pou.name}:${v.name}[${iecIdx}]`, addr)
              }
            }
          }
        }
      } else {
        const path = `${upperInstance}.${v.name.toUpperCase()}`
        const addr = pathToAddr.get(path)
        if (addr !== undefined) {
          indexMap.set(`${pou.name}:${v.name}`, addr)
        }
      }
    })
  })

  // Fallback: also key by the raw debug path so any leaves we didn't cover
  // (nested fields, FB internals) remain reachable by path.
  for (const leaf of map.leaves) {
    if (!indexMap.has(leaf.path)) {
      indexMap.set(leaf.path, packDebugAddr(leaf))
    }
  }

  return { indexMap, warnings }
}

/**
 * Synthesize a DebugVariableEntry[] from a DebugMapV2 so the existing tree
 * builder (which consumes v1-shaped data) works unchanged. The `index`
 * field carries the packed (arr<<16|elem) address.
 */
export function debugMapV2ToEntries(map: DebugMapV2): DebugVariableEntry[] {
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
}

/**
 * Build a flat compositeKey -> DebugTreeNode map by traversing all program
 * POU variables. Pure function — swallows per-variable errors to match
 * existing behaviour.
 */
export function buildDebugVariableTreeMap(
  pous: PLCPou[],
  instances: PLCInstance[],
  debugVariables: DebugVariableEntry[],
  projectData: { dataTypes: PLCDataType[]; pous: PLCPou[] },
): DebugVariableTreeMapResult {
  const trees: DebugTreeNode[] = []
  const treeMap = new Map<string, DebugTreeNode>()
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
    if (!instanceName) return

    const variables = pou.interface?.variables ?? []
    variables.forEach((v: PLCVariable) => {
      try {
        const node = buildDebugTree(v, pou.name, instanceName, debugVariables, projectData)
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

  return { treeMap, trees, complexCount }
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
