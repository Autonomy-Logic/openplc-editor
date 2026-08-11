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

import type { DebugTreeNode, FbInstanceInfo } from '../../middleware/shared/ports/types'
import { useDebugger } from '../../middleware/shared/providers'
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
   * Takes nothing: the connection manager holds the session for every target by the
   * time a debug session can start, so there is no medium for a caller to name.
   */
  connectAndStart: () => Promise<{ success: boolean; error?: string }>

  /** Disconnect from the debug target and clear all debug state. */
  stopSession: () => Promise<void>

  /** Force or release a variable via the debugger port. */
  forceVariable: (index: number, force: boolean, valueHex?: string) => Promise<boolean>

  /** Debug tree nodes built for each POU, keyed by pouName. */
  debugTreesRef: React.MutableRefObject<Record<string, DebugTreeNode[]>>
}

export function useDebugSession(): UseDebugSessionReturn {
  const debuggerPort = useDebugger()

  const {
    project: { data: projectData, meta: projectMeta },
    deviceDefinitions,
    workspaceActions,
    consoleActions,
  } = useOpenPLCStore()

  const debugTreesRef = useRef<Record<string, DebugTreeNode[]>>({})

  const connectAndStart = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
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
      const connectResult = await debuggerPort.connect()
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
      // The target's address, for the debugger's own display. Comes from the
      // session the manager holds, not from a config the caller chose.
      const sessionEndpoint = useOpenPLCStore.getState().deviceConnection.port
      if (sessionEndpoint) wsActions.setDebuggerTargetIp(sessionEndpoint)

      // Nothing to record about the transport: `useDebugPolling` reads the medium
      // the connection manager published (`deviceConnection.debugTransport`) and
      // derives both its batch size and its cadence from it. Copying that into a
      // second store field is what let the two disagree — and made a session whose
      // medium was not yet known silently poll as if it were the simulator.
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
  }, [debuggerPort, deviceDefinitions, projectData, projectMeta])

  /**
   * End the debug session — and ONLY the debug session.
   *
   * It used to stop the simulator too, which had the ownership backwards: a debug
   * session is a consumer of a connection, not the owner of the thing on the other
   * end. Stopping the simulator is the Stop button's job (`handleSimulatorControl`),
   * and closing that session is the connection manager's.
   */
  const stopSession = useCallback(async () => {
    await debuggerPort.disconnect()

    workspaceActions.clearDebugState()
    debugTreesRef.current = {}
  }, [debuggerPort, workspaceActions])

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
