/**
 * Debug Session Hook
 *
 * Manages the debug session lifecycle: parse debug.c, build index/tree maps,
 * commit debug artifacts to the store, and delegate protocol operations to
 * the debugBridge singleton.
 *
 * This hook is transport-agnostic — it never calls simulatorService or
 * sendDebugMessage directly. The debugBridge handles all transport concerns.
 *
 * Mirrors the desktop editor's session management in debugger-session.ts
 * and workspace-screen.tsx.
 */

import { useCallback, useRef } from 'react'

import { useOpenPLCStore } from '../store'
import { debugBridge } from '../services/debug'
import { parseDebugFile } from '../utils/debug-parser'
import { hexToBytes } from '../utils/hex'
import { buildDebugTree } from '../utils/debug-tree-builder'
import { findInstanceName, buildDebugPathPrefix, type PLCInstanceMapping } from '../utils/debug-variable-finder'
import { simulatorService } from '../services/simulator'
import type { DebugTreeNode, FbInstanceInfo } from '../../middleware/shared/ports/types'

export interface UseDebugSessionReturn {
  /** Parse debug.c, build trees/indexes, commit to store, activate debugger.
   *  Parameters deviceId/username/password are kept for API compatibility but unused
   *  by the session hook — the caller sets up the transport on debugBridge first. */
  startDebug: (deviceId: string, username: string, password: string, debugCContent: string, port?: number) => boolean
  /** Stop the debug session and clean up all state. */
  stopDebug: () => void
  /** Force or release a variable via debugBridge. */
  forceVariable: (index: number, force: boolean, valueHex?: string) => Promise<boolean>
  /** Debug tree nodes built for each POU, keyed by pouName. */
  debugTreesRef: React.MutableRefObject<Record<string, DebugTreeNode[]>>
}

export function useDebugSession(): UseDebugSessionReturn {
  const {
    project: { data: projectData },
    workspace,
    workspaceActions,
    consoleActions,
  } = useOpenPLCStore()

  const localMd5Ref = useRef<string | null>(null)
  const debugTreesRef = useRef<Record<string, DebugTreeNode[]>>({})

  /**
   * Start a debug session: parse debug.c, build index maps, commit to store.
   * The caller is responsible for setting up the transport on debugBridge first.
   */
  const startDebug = useCallback(
    (...[, , , debugCContent]: [string, string, string, string, number?]): boolean => {
      if (!debugCContent) {
        consoleActions.addLog({
          id: crypto.randomUUID(),
          level: 'error',
          message: 'No debug.c content available. Build the project first.',
        })
        return false
      }

      const { editingState } = useOpenPLCStore.getState().workspace
      if (editingState === 'unsaved') {
        consoleActions.addLog({
          id: crypto.randomUUID(),
          level: 'warning',
          message: 'Project has unsaved changes. The debugger will use the last compiled version.',
        })
      }

      // Parse debug.c to extract variable indexes
      const parsed = parseDebugFile(debugCContent)

      // Build index map: path -> index
      const indexMap = new Map<string, number>()
      for (const v of parsed.variables) {
        indexMap.set(v.name, v.index)
      }

      localMd5Ref.current = workspace.debugLocalMd5

      // Build debug trees for each program POU
      const instances: PLCInstanceMapping[] = (projectData.configurations?.resource?.instances || []).map((inst) => ({
        name: inst.name,
        program: inst.program,
      }))

      const trees: Record<string, DebugTreeNode[]> = {}

      for (const pou of projectData.pous) {
        if (pou.type !== 'program') continue

        const instanceName = findInstanceName(pou.data.name, instances)
        if (!instanceName) continue

        const pouTrees: DebugTreeNode[] = []

        for (const variable of pou.data.variables) {
          const tree = buildDebugTree(variable, pou.data.name, instanceName, parsed.variables, projectData)
          pouTrees.push(tree)
        }

        // Add compiler-generated _TMP_ variables (function block/function outputs)
        // needed for painting block output edges in LD/FBD editors.
        const instancePrefix = buildDebugPathPrefix(instanceName) + '.'
        for (const dv of parsed.variables) {
          if (!dv.name.startsWith(instancePrefix)) continue
          const localName = dv.name.slice(instancePrefix.length)
          if (!localName.startsWith('_TMP_')) continue

          let typeName = dv.type
          if (typeName.endsWith('_O_ENUM') || typeName.endsWith('_P_ENUM')) {
            typeName = typeName.replace(/_(O|P)_ENUM$/, '')
          } else if (typeName.endsWith('_ENUM')) {
            typeName = typeName.replace(/_ENUM$/, '')
          }

          pouTrees.push({
            name: localName,
            fullPath: dv.name,
            compositeKey: `${pou.data.name}:${localName}`,
            type: typeName,
            isComplex: false,
            debugIndex: dv.index,
          })
        }

        trees[pou.data.name] = pouTrees
      }

      debugTreesRef.current = trees

      // Augment index map with composite keys from the debug tree
      const addCompositeKeyIndexes = (node: DebugTreeNode) => {
        if (node.debugIndex !== undefined) {
          indexMap.set(node.compositeKey, node.debugIndex)
        }
        if (node.children) {
          for (const child of node.children) {
            addCompositeKeyIndexes(child)
          }
        }
      }
      for (const pouTrees of Object.values(trees)) {
        for (const node of pouTrees) {
          addCompositeKeyIndexes(node)
        }
      }
      workspaceActions.setDebugVariableIndexes(indexMap)

      // Flatten all trees into the store
      const flatTree = new Map<string, DebugTreeNode>()
      for (const pouTrees of Object.values(trees)) {
        for (const node of pouTrees) {
          flatTree.set(node.compositeKey, node)
        }
      }
      workspaceActions.setDebugVariableTree(flatTree)

      // Build FB instance maps from project data
      const fbInstances = new Map<string, FbInstanceInfo[]>()
      for (const pou of projectData.pous) {
        if (pou.type !== 'function-block') continue
        const fbTypeName = pou.data.name.toUpperCase()
        const instanceList: FbInstanceInfo[] = []

        for (const programPou of projectData.pous) {
          if (programPou.type !== 'program') continue
          const progInstanceName = findInstanceName(programPou.data.name, instances)
          if (!progInstanceName) continue

          for (const variable of programPou.data.variables) {
            if (variable.type.definition === 'derived' && variable.type.value.toUpperCase() === fbTypeName) {
              const key = `${programPou.data.name}:${variable.name}`
              instanceList.push({
                fbTypeName: pou.data.name,
                programName: programPou.data.name,
                programInstanceName: progInstanceName,
                fbVariableName: variable.name,
                key,
              })
            }
          }
        }

        if (instanceList.length > 0) {
          fbInstances.set(fbTypeName, instanceList)
          workspaceActions.setFbSelectedInstance(fbTypeName, instanceList[0].key)
        }
      }
      workspaceActions.setFbDebugInstances(fbInstances)

      consoleActions.addLog({
        id: crypto.randomUUID(),
        level: 'info',
        message: `Debug session starting: ${parsed.variables.length} variables indexed`,
      })

      // MD5 verification via debugBridge (transport-agnostic)
      const localMd5Value = localMd5Ref.current
      if (localMd5Value) {
        void debugBridge
          .verifyMd5(localMd5Value)
          .then((result) => {
            if (result.success && result.match === false) {
              consoleActions.addLog({
                id: crypto.randomUUID(),
                level: 'warning',
                message: `MD5 mismatch. Runtime: ${result.targetMd5}, Local: ${localMd5Value}`,
              })
              workspaceActions.setDebugMd5Mismatch({
                runtimeMd5: result.targetMd5 ?? '',
                localMd5: localMd5Value,
              })
            } else if (result.success) {
              consoleActions.addLog({
                id: crypto.randomUUID(),
                level: 'info',
                message: 'MD5 verification successful.',
              })
            }
          })
          .catch(() => {
            consoleActions.addLog({
              id: crypto.randomUUID(),
              level: 'warning',
              message: 'Could not verify MD5 hash. Continuing anyway.',
            })
          })
      }

      // Activate debugger
      workspaceActions.setDebuggerVisible(true)
      return true
    },
    [workspace.debugLocalMd5, projectData, workspaceActions, consoleActions],
  )

  /**
   * Stop the debug session. Delegates disconnect to debugBridge.
   */
  const stopDebug = useCallback(() => {
    // If simulator is running, stop it
    if (simulatorService.isRunning()) {
      simulatorService.stop()
    }

    // Disconnect transport via bridge
    void debugBridge.disconnect()

    workspaceActions.clearDebugState()
    debugTreesRef.current = {}
    localMd5Ref.current = null
  }, [workspaceActions])

  /**
   * Force or release a variable via debugBridge (transport-agnostic).
   */
  const forceVariable = useCallback(
    async (index: number, force: boolean, valueHex = '00'): Promise<boolean> => {
      const valueBuffer = hexToBytes(valueHex)
      const result = await debugBridge.setVariable(index, force, force ? valueBuffer : undefined)
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
    [consoleActions],
  )

  return {
    startDebug,
    stopDebug,
    forceVariable,
    debugTreesRef,
  }
}
