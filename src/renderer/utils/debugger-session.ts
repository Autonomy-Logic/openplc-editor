/**
 * Shared debugger session helpers.
 *
 * Extracted from the workspace activity bar to eliminate code duplication
 * between `connectDebuggerAfterBuild` (simulator flow) and
 * `handleMd5Verification` (non-simulator flow).
 */

import { StandardFunctionBlocks } from '@root/renderer/data/library/standard-function-blocks'
import type { WorkspaceActions } from '@root/renderer/store/slices/workspace/types'
import { buildDebugTree } from '@root/renderer/utils/debug-tree-builder'
import type { DebugTreeNode, FbInstanceInfo } from '@root/types/debugger'
import type { PLCInstance, PLCPou, PLCProject, PLCVariable } from '@root/types/PLC/open-plc'
import type { DebugVariableEntry } from '@root/utils/debug-parser'
import {
  buildGlobalDebugPath,
  findDebugVariable,
  findGlobalVariableIndex,
  findVariableIndex,
  findVariableIndexWithFallback,
} from '@root/utils/debug-variable-finder'
import { normalizeTypeString } from '@root/utils/pou-helpers'

// ---------------------------------------------------------------------------
// 1. disconnectDebugger
// ---------------------------------------------------------------------------

/**
 * Disconnect the debugger and reset all related workspace state.
 * Replaces the 5-line disconnect+cleanup pattern used in 3 call sites.
 */
export async function disconnectDebugger(workspaceActions: WorkspaceActions): Promise<void> {
  await window.bridge.debuggerDisconnect()
  workspaceActions.setDebuggerVisible(false)
  workspaceActions.setDebuggerTargetIp(null)
  workspaceActions.setDebugForcedVariables(new Map())
  workspaceActions.clearFbDebugContext()
}

// ---------------------------------------------------------------------------
// 2. buildVariableIndexMap
// ---------------------------------------------------------------------------

export interface VariableIndexMapResult {
  indexMap: Map<string, number>
  warnings: string[]
}

/**
 * Build a composite-key → debug-index map from parsed debug variables.
 * Pure function — caller is responsible for logging warnings.
 */
export function buildVariableIndexMap(
  pous: PLCPou[],
  instances: PLCInstance[],
  parsed: { variables: DebugVariableEntry[] },
): VariableIndexMapResult {
  const indexMap = new Map<string, number>()
  const warnings: string[] = []

  pous.forEach((pou) => {
    if (pou.type !== 'program') return

    const instance = instances.find((inst) => inst.program === pou.data.name)
    if (!instance) {
      warnings.push(`No instance found for program '${pou.data.name}', skipping debug variable parsing.`)
      return
    }

    pou.data.variables.forEach((v: PLCVariable) => {
      if (v.type.definition === 'array' && v.type.data) {
        // Array variables don't have a single debug index - each element has its own index.
        // Add entries for each element so they can be polled individually.
        const dimensions = v.type.data.dimensions
        if (dimensions.length > 0) {
          const dimMatch = dimensions[0].dimension.match(/^(-?\d+)\.\.(-?\d+)$/)
          if (dimMatch) {
            const startIdx = parseInt(dimMatch[1], 10)
            const endIdx = parseInt(dimMatch[2], 10)
            for (let i = 0; i <= endIdx - startIdx; i++) {
              let elementIndex: number | null
              if (v.class === 'external') {
                // External (global) array elements use CONFIG0__ prefix
                const globalPath = `${buildGlobalDebugPath(v.name)}.value.table[${i}]`
                const match = findDebugVariable(parsed.variables, globalPath)
                elementIndex = match ? match.index : null
              } else {
                elementIndex = findVariableIndex(instance.name, v.name, parsed.variables, {
                  isArrayElement: true,
                  arrayIndex: i,
                })
              }
              if (elementIndex !== null) {
                const compositeKey = `${pou.data.name}:${v.name}[${startIdx + i}]`
                indexMap.set(compositeKey, elementIndex)
              }
            }
          }
        }
      } else {
        const index =
          v.class === 'external'
            ? findGlobalVariableIndex(v.name, parsed.variables)
            : findVariableIndexWithFallback(instance.name, v.name, parsed.variables)
        if (index !== null) {
          const compositeKey = `${pou.data.name}:${v.name}`
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
// 3. buildDebugVariableTreeMap
// ---------------------------------------------------------------------------

export interface DebugVariableTreeMapResult {
  treeMap: Map<string, DebugTreeNode>
  trees: DebugTreeNode[]
  complexCount: number
}

/**
 * Build a flat compositeKey → DebugTreeNode map by traversing all program
 * POU variables. Pure function — swallows per-variable errors to match
 * existing behaviour.
 */
export function buildDebugVariableTreeMap(
  pous: PLCPou[],
  instances: PLCInstance[],
  debugVariables: DebugVariableEntry[],
  project: PLCProject,
): DebugVariableTreeMapResult {
  const trees: DebugTreeNode[] = []
  const treeMap = new Map<string, DebugTreeNode>()
  let complexCount = 0

  const addNodeAndChildrenToMap = (node: DebugTreeNode) => {
    treeMap.set(node.compositeKey, node)
    if (node.children) {
      for (const child of node.children) {
        addNodeAndChildrenToMap(child)
      }
    }
  }

  pous.forEach((pou) => {
    if (pou.type !== 'program') return

    const instance = instances.find((inst) => inst.program === pou.data.name)
    if (!instance) return

    pou.data.variables.forEach((v: PLCVariable) => {
      try {
        const node = buildDebugTree(v, pou.data.name, instance.name, debugVariables, project)
        trees.push(node)
        addNodeAndChildrenToMap(node)
        if (node.isComplex) {
          complexCount++
        }
      } catch {
        // Tree building failed for this variable — swallow to match existing behaviour
      }
    })
  })

  return { treeMap, trees, complexCount }
}

// ---------------------------------------------------------------------------
// 4. buildFbInstanceMap
// ---------------------------------------------------------------------------

/**
 * Build a map of FB type name (uppercased) → FbInstanceInfo[] for all
 * derived-type variables that are function blocks.
 * Uses the canonical `normalizeTypeString` from pou-helpers instead of
 * redefining it inline.
 */
export function buildFbInstanceMap(pous: PLCPou[], instances: PLCInstance[]): Map<string, FbInstanceInfo[]> {
  const fbDebugInstancesMap = new Map<string, FbInstanceInfo[]>()

  pous.forEach((pou) => {
    if (pou.type !== 'program') return

    const programInstance = instances.find((inst) => inst.program === pou.data.name)
    if (!programInstance) return

    pou.data.variables.forEach((v: PLCVariable) => {
      if (v.type.definition !== 'derived') return

      const fbTypeNameRaw = v.type.value
      const fbTypeKey = fbTypeNameRaw.toUpperCase()

      const isStandardFB = StandardFunctionBlocks.pous.some(
        (sfb) => sfb.name.toUpperCase() === fbTypeKey && normalizeTypeString(sfb.type) === 'functionblock',
      )

      const isCustomFB = pous.some(
        (p) => normalizeTypeString(p.type) === 'functionblock' && p.data.name.toUpperCase() === fbTypeKey,
      )

      if (isStandardFB || isCustomFB) {
        const instanceInfo: FbInstanceInfo = {
          fbTypeName: fbTypeNameRaw,
          programName: pou.data.name,
          programInstanceName: programInstance.name,
          fbVariableName: v.name,
          key: `${pou.data.name}:${v.name}`,
        }

        const existingInstances = fbDebugInstancesMap.get(fbTypeKey) || []
        existingInstances.push(instanceInfo)
        fbDebugInstancesMap.set(fbTypeKey, existingInstances)
      }
    })
  })

  return fbDebugInstancesMap
}

// ---------------------------------------------------------------------------
// 5. connectAndActivateDebugger
// ---------------------------------------------------------------------------

export interface ConnectAndActivateParams {
  connectionType: 'tcp' | 'rtu' | 'websocket' | 'simulator'
  connectionParams: {
    ipAddress?: string
    port?: string
    baudRate?: number
    slaveId?: number
    jwtToken?: string
  }
  indexMap: Map<string, number>
  treeMap: Map<string, DebugTreeNode>
  fbDebugInstancesMap: Map<string, FbInstanceInfo[]>
  targetIpAddress?: string
  isRuntimeTarget?: boolean
}

export interface ConnectAndActivateResult {
  success: boolean
  error?: string
}

/**
 * Connect to the debugger backend and commit all debug artifacts to the
 * Zustand store. Returns `{ success: false, error }` when the bridge
 * connection fails.
 */
export async function connectAndActivateDebugger(
  params: ConnectAndActivateParams,
  workspaceActions: WorkspaceActions,
): Promise<ConnectAndActivateResult> {
  const connectResult: { success: boolean; error?: string } = await window.bridge.debuggerConnect(
    params.connectionType,
    params.connectionParams,
  )

  if (!connectResult.success) {
    return { success: false, error: connectResult.error || 'Unknown error' }
  }

  workspaceActions.setDebugVariableIndexes(params.indexMap)
  workspaceActions.setDebugVariableTree(params.treeMap)
  workspaceActions.setFbDebugInstances(params.fbDebugInstancesMap)

  // Set default selected instance for each FB type (first instance)
  params.fbDebugInstancesMap.forEach((instanceList, fbTypeName) => {
    if (instanceList.length > 0) {
      workspaceActions.setFbSelectedInstance(fbTypeName, instanceList[0].key)
    }
  })

  // Set target IP for non-runtime, non-simulator connections
  if (!params.isRuntimeTarget && params.connectionType !== 'simulator') {
    workspaceActions.setDebuggerTargetIp(params.targetIpAddress ?? null)
  }

  workspaceActions.setDebuggerVisible(true)

  return { success: true }
}
