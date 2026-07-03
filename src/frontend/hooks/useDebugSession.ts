/**
 * Debug Session Hook
 *
 * Manages the debug session lifecycle: read debug-map.json, build index/tree
 * maps, commit debug artifacts to the store, connect/disconnect via
 * DebuggerPort.
 *
 * Platform-agnostic — all protocol operations are delegated to the
 * DebuggerPort and SimulatorPort provided by the PlatformProvider.
 * The backend adapter decides the actual transport (IPC, HTTP, WebRTC, etc.).
 */

import { useCallback, useRef } from 'react'

import type { DebugConnectionConfig, DebugTreeNode, FbInstanceInfo } from '../../middleware/shared/ports/types'
import { useDebugger, useSimulator } from '../../middleware/shared/providers'
import { useOpenPLCStore } from '../store'
import { parseDebugMap } from '../utils/debug-parser'
import {
  buildDebugVariableTreeMap,
  buildFbInstanceMap,
  debugMapToEntries,
  deriveVariableIndexMap,
} from '../utils/debugger-session'
import { encodeForceValue } from '../utils/variable-sizes'

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
        const debugFileResult = await debuggerPort.readDebugFile(projectPath, boardTarget)
        if (!debugFileResult.success || !debugFileResult.content) {
          const error = `Failed to read debug-map.json: ${debugFileResult.error ?? 'No content'}`
          logActions.addLog({ id: crypto.randomUUID(), level: 'error', message: error })
          return { success: false, error }
        }

        wsActions.setDebugCContent(debugFileResult.content)

        const instances = project.data.configurations.resource.instances

        const debugMap = parseDebugMap(debugFileResult.content)
        if (!debugMap) {
          const error = 'Invalid debug-map.json (expected schema version 2)'
          logActions.addLog({ id: crypto.randomUUID(), level: 'error', message: error })
          return { success: false, error }
        }

        const entriesForTree = debugMapToEntries(debugMap)
        logActions.addLog({
          id: crypto.randomUUID(),
          level: 'info',
          message: `Debug map: ${debugMap.leaves.length} leaves across ${debugMap.arrays.length} arrays.`,
        })

        // Build the debug variable tree — the single enumeration walk. The
        // composite-key → index map (used by the LD/FBD editors and the poller)
        // is derived from this same tree, so every consumer resolves a
        // variable's address identically.
        let treeMap = new Map<string, DebugTreeNode>()
        const pouTrees: Record<string, DebugTreeNode[]> = {}
        try {
          const treeResult = buildDebugVariableTreeMap(
            project.data.pous,
            instances,
            entriesForTree,
            project.data,
            useOpenPLCStore.getState().libraries.system,
          )
          treeMap = treeResult.treeMap

          // Group trees by POU name for polling hook
          for (const node of treeResult.trees) {
            const pouName = node.compositeKey.split(':')[0]
            if (!pouTrees[pouName]) pouTrees[pouName] = []
            pouTrees[pouName].push(node)
          }

          for (const w of treeResult.warnings) {
            logActions.addLog({ id: crypto.randomUUID(), level: 'warning', message: w })
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

        // Derive the composite-key → packed-address map from the tree leaves.
        const indexMap = deriveVariableIndexMap(treeMap, debugMap)

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

        // Record the active transport so useDebugPolling picks the right
        // poll cadence + batch size.  Set on EVERY start path (runtime
        // targets also set it earlier in handleMd5Verification; this
        // additionally covers the simulator path, which doesn't go
        // through MD5 verification — without it the simulator stayed at
        // the default 200ms instead of its intended 50ms).  Must be set
        // before `setDebuggerVisible(true)`, which is what triggers the
        // polling effect.
        wsActions.setDebugConnectionType(debugConfig.connectionType)

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
    async (index: number, force: boolean, value?: string, type?: string, enumValues?: string[]): Promise<boolean> => {
      let valueBuffer: Uint8Array | undefined
      if (force) {
        try {
          valueBuffer = encodeForceValue(value ?? '0', type ?? 'BOOL', enumValues)
        } catch (err) {
          consoleActions.addLog({
            id: crypto.randomUUID(),
            level: 'error',
            message: `Force input error: ${err instanceof Error ? err.message : String(err)}`,
          })
          return false
        }
      }
      const result = await debuggerPort.setVariable(index, force, valueBuffer)
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
