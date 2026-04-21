/**
 * Debug Session Hook
 *
 * Manages the debug session lifecycle: read debug.c, build index/tree maps,
 * commit debug artifacts to the store, connect/disconnect via DebuggerPort.
 *
 * Platform-agnostic — all protocol operations are delegated to the
 * DebuggerPort and SimulatorPort provided by the PlatformProvider.
 * The backend adapter decides the actual transport (IPC, HTTP, WebRTC, etc.).
 */

import { useCallback, useRef } from 'react'

import type { DebugConnectionConfig, DebugTreeNode, FbInstanceInfo } from '../../middleware/shared/ports/types'
import { useDebugger, useSimulator } from '../../middleware/shared/providers'
import { useOpenPLCStore } from '../store'
import { parseDebugFile, parseDebugMapV2 } from '../utils/debug-parser'
import {
  buildDebugVariableTreeMap,
  buildFbInstanceMap,
  buildVariableIndexMap,
  buildVariableIndexMapV2,
  debugMapV2ToEntries,
} from '../utils/debugger-session'
import { hexToBytes } from '../utils/hex'

export interface UseDebugSessionReturn {
  /**
   * Connect to the debug target and start a debug session.
   *
   * Reads the debug file, parses it, builds variable index/tree/FB maps,
   * connects via the debugger port, stores all artifacts in workspace,
   * and activates the debugger UI.
   *
   * @param config — Connection target (simulator, TCP, RTU, WebSocket).
   *                 If omitted, defaults to simulator.
   */
  connectAndStart: (config?: DebugConnectionConfig) => Promise<{ success: boolean; error?: string }>

  /** Disconnect from the debug target and clear all debug state. */
  stopSession: () => Promise<void>

  /** Force or release a variable via the debugger port. */
  forceVariable: (index: number, force: boolean, valueHex?: string) => Promise<boolean>

  /** Debug tree nodes built for each POU, keyed by pouName. */
  debugTreesRef: React.MutableRefObject<Record<string, DebugTreeNode[]>>
}

export function useDebugSession(): UseDebugSessionReturn {
  const debuggerPort = useDebugger()
  const simulator = useSimulator()

  const {
    project: { data: projectData, meta: projectMeta },
    deviceDefinitions,
    workspaceActions,
    consoleActions,
  } = useOpenPLCStore()

  const debugTreesRef = useRef<Record<string, DebugTreeNode[]>>({})

  const connectAndStart = useCallback(
    async (config?: DebugConnectionConfig): Promise<{ success: boolean; error?: string }> => {
      const debugConfig = config ?? ({ connectionType: 'simulator', connectionParams: {} } as DebugConnectionConfig)
      const { project, workspaceActions: wsActions, consoleActions: logActions } = useOpenPLCStore.getState()
      const boardTarget = deviceDefinitions.configuration.deviceBoard
      const projectPath = project.meta.path

      logActions.addLog({ id: crypto.randomUUID(), level: 'info', message: 'Connecting debugger...' })

      try {
        // Read debug artifacts. Phase 4 (STruC++) projects ship
        // debug-map.json; legacy MatIEC projects ship debug.c. The port's
        // readDebugFile returns whichever exists — v2 JSON takes priority.
        const debugFileResult = await debuggerPort.readDebugFile(projectPath, boardTarget)
        if (!debugFileResult.success || !debugFileResult.content) {
          const error = `Failed to read debug file: ${debugFileResult.error ?? 'No content'}`
          logActions.addLog({ id: crypto.randomUUID(), level: 'error', message: error })
          return { success: false, error }
        }

        wsActions.setDebugCContent(debugFileResult.content)

        const instances = project.data.configurations.resource.instances

        // Try the v2 (debug-map.json) path first; fall back to v1 (debug.c).
        const v2 = parseDebugMapV2(debugFileResult.content)

        let indexMap: Map<string, number>
        let warnings: string[]
        let entriesForTree: ReturnType<typeof debugMapV2ToEntries>

        if (v2) {
          const v2Result = buildVariableIndexMapV2(project.data.pous, instances, v2)
          indexMap = v2Result.indexMap
          warnings = v2Result.warnings
          entriesForTree = debugMapV2ToEntries(v2)
          logActions.addLog({
            id: crypto.randomUUID(),
            level: 'info',
            message: `Debug map v2: ${v2.leaves.length} leaves across ${v2.arrays.length} arrays.`,
          })
        } else {
          const parsed = parseDebugFile(debugFileResult.content)
          const v1Result = buildVariableIndexMap(project.data.pous, instances, parsed)
          indexMap = v1Result.indexMap
          warnings = v1Result.warnings
          entriesForTree = parsed.variables
        }

        for (const w of warnings) {
          logActions.addLog({ id: crypto.randomUUID(), level: 'warning', message: w })
        }

        // Build debug variable tree
        let treeMap = new Map<string, DebugTreeNode>()
        const pouTrees: Record<string, DebugTreeNode[]> = {}
        try {
          const treeResult = buildDebugVariableTreeMap(project.data.pous, instances, entriesForTree, project.data)
          treeMap = treeResult.treeMap

          // Group trees by POU name for polling hook
          for (const node of treeResult.trees) {
            const pouName = node.compositeKey.split(':')[0]
            if (!pouTrees[pouName]) pouTrees[pouName] = []
            pouTrees[pouName].push(node)
          }

          logActions.addLog({
            id: crypto.randomUUID(),
            level: 'info',
            message: `Debug tree builder: Built ${treeResult.trees.length} trees (${treeResult.complexCount} complex).`,
          })
        } catch {
          logActions.addLog({
            id: crypto.randomUUID(),
            level: 'warning',
            message: 'Debug tree builder encountered errors.',
          })
        }

        debugTreesRef.current = pouTrees

        // Build FB instance map
        const fbDebugInstancesMap = buildFbInstanceMap(project.data.pous, instances)

        const fbTypesCount = fbDebugInstancesMap.size
        const totalFbInstances = Array.from(fbDebugInstancesMap.values()).reduce((sum, list) => sum + list.length, 0)
        if (fbTypesCount > 0) {
          logActions.addLog({
            id: crypto.randomUUID(),
            level: 'info',
            message: `FB instance map: Found ${totalFbInstances} instances across ${fbTypesCount} FB types.`,
          })
        }

        // Connect debugger via port
        const connectResult = await debuggerPort.connect(debugConfig)
        if (!connectResult.success) {
          const error = `Debugger connection failed: ${connectResult.error ?? 'Unknown error'}`
          logActions.addLog({ id: crypto.randomUUID(), level: 'error', message: error })
          return { success: false, error }
        }

        // Store debug artifacts in workspace
        wsActions.setDebugVariableIndexes(indexMap)
        wsActions.setDebugVariableTree(treeMap)
        wsActions.setFbDebugInstances(fbDebugInstancesMap)

        // Set default selected instance for each FB type
        fbDebugInstancesMap.forEach((instanceList: FbInstanceInfo[], fbTypeName: string) => {
          if (instanceList.length > 0) {
            wsActions.setFbSelectedInstance(fbTypeName, instanceList[0].key)
          }
        })

        // Set target IP for non-simulator connections
        if (debugConfig.connectionType !== 'simulator' && debugConfig.connectionParams.ipAddress) {
          wsActions.setDebuggerTargetIp(debugConfig.connectionParams.ipAddress)
        }

        wsActions.setDebuggerVisible(true)
        logActions.addLog({
          id: crypto.randomUUID(),
          level: 'info',
          message: `Debugger connected. Found ${indexMap.size} debug variables.`,
        })

        return { success: true }
      } catch (err: unknown) {
        const error = `Debugger error: ${err instanceof Error ? err.message : String(err)}`
        logActions.addLog({ id: crypto.randomUUID(), level: 'error', message: error })
        return { success: false, error }
      }
    },
    [debuggerPort, deviceDefinitions, projectData, projectMeta],
  )

  const stopSession = useCallback(async () => {
    // If simulator is running, stop it
    if (simulator.isRunning()) {
      await simulator.stop()
    }

    // Disconnect debugger
    await debuggerPort.disconnect()

    // Clear all debug state
    workspaceActions.clearDebugState()
    debugTreesRef.current = {}
  }, [simulator, debuggerPort, workspaceActions])

  const forceVariable = useCallback(
    async (index: number, force: boolean, valueHex = '00'): Promise<boolean> => {
      const valueBuffer = hexToBytes(valueHex)
      const result = await debuggerPort.setVariable(index, force, force ? valueBuffer : undefined)
      if (result.success) {
        consoleActions.addLog({
          id: crypto.randomUUID(),
          level: 'info',
          message: 'Variable force applied successfully',
        })
        return true
      } else {
        consoleActions.addLog({
          id: crypto.randomUUID(),
          level: 'error',
          message: `Failed to set variable: ${result.error}`,
        })
        return false
      }
    },
    [debuggerPort, consoleActions],
  )

  return {
    connectAndStart,
    stopSession,
    forceVariable,
    debugTreesRef,
  }
}
