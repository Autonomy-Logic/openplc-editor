/**
 * Shared debugger session helpers.
 *
 * Builds the debug variable index map, debug tree, and FB instance map
 * from parsed debug.c data and project structure. These artifacts are
 * stored in the workspace Zustand store for the debugger UI.
 *
 * Works with the port-format types (PLCPou flat format) used by both
 * the editor and web platforms.
 */

import type {
  DebugTreeNode,
  FbInstanceInfo,
  PLCDataType,
  PLCInstance,
  PLCPou,
  PLCVariable,
} from '../../middleware/shared/ports/types'
import type { DebugVariableEntry, ParsedDebugData } from './debug-parser'
import { buildDebugTree } from './debug-tree-builder'
import {
  buildDebugPathPrefix,
  buildGlobalDebugPath,
  findDebugVariable,
  findGlobalVariableIndex,
  findInstanceName,
  findVariableIndex,
  findVariableIndexWithFallback,
  type PLCInstanceMapping,
} from './debug-variable-finder'

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
// 1. buildVariableIndexMap
// ---------------------------------------------------------------------------

export interface VariableIndexMapResult {
  indexMap: Map<string, number>
  warnings: string[]
}

/**
 * Build a composite-key -> debug-index map from parsed debug variables.
 * Pure function — caller is responsible for logging warnings.
 */
export function buildVariableIndexMap(
  pous: PLCPou[],
  instances: PLCInstance[],
  parsed: ParsedDebugData,
): VariableIndexMapResult {
  const indexMap = new Map<string, number>()
  const warnings: string[] = []

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
              let elementIndex: number | null
              if (v.class === 'external') {
                const globalPath = `${buildGlobalDebugPath(v.name)}.value.table[${i}]`
                const match = findDebugVariable(parsed.variables, globalPath)
                elementIndex = match ? match.index : null
              } else {
                elementIndex = findVariableIndex(instanceName, v.name, parsed.variables, {
                  isArrayElement: true,
                  arrayIndex: i,
                })
              }
              if (elementIndex !== null) {
                const compositeKey = `${pou.name}:${v.name}[${startIdx + i}]`
                indexMap.set(compositeKey, elementIndex)
              }
            }
          }
        }
      } else {
        const index =
          v.class === 'external'
            ? findGlobalVariableIndex(v.name, parsed.variables)
            : findVariableIndexWithFallback(instanceName, v.name, parsed.variables)
        if (index !== null) {
          const compositeKey = `${pou.name}:${v.name}`
          indexMap.set(compositeKey, index)
        }
      }
    })
  })

  // Append any unmatched parsed variables as fallback entries
  parsed.variables.forEach((debugVar) => {
    if (!indexMap.has(debugVar.name)) {
      indexMap.set(debugVar.name, debugVar.index)
    }
  })

  return { indexMap, warnings }
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
