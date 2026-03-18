/**
 * Debug Polling Hook
 *
 * When the debugger is visible, polls variable values from the runtime
 * via DebuggerPort.getVariablesList() at a board-aware interval.
 *
 * Platform-agnostic — the DebuggerPort adapter handles the actual transport
 * (IPC to main process, HTTP, WebRTC, simulator virtual serial port, etc.).
 *
 * Polling behavior:
 * - Single-batch-per-cycle with round-robin offset
 * - Dynamic batch sizing (halves on ERROR_OUT_OF_MEMORY)
 * - lastIndex-aware advancement (runtime may return partial data)
 * - isPolling guard to skip tick if previous poll is in progress
 *
 * Polling intervals:
 * - Simulator board: 50ms  (Modbus RTU frame timing)
 * - Other boards:   200ms  (general purpose)
 */

import { useCallback, useEffect, useRef } from 'react'

import type { DebugTreeNode } from '../../middleware/shared/ports/types'
import { useDebugger } from '../../middleware/shared/providers'
import { useOpenPLCStore } from '../store'
import { getTypeSizeByName, parseValueByTypeName } from '../utils/variable-sizes'

/** Polling interval for simulator boards (Modbus RTU). */
const SIMULATOR_POLL_INTERVAL_MS = 50
/** Polling interval for non-simulator boards. */
const DEFAULT_POLL_INTERVAL_MS = 200

/** Default batch size for variable polling. */
const DEFAULT_BATCH_SIZE = 60
/** Batch size for simulator (smaller due to RTU frame limits). */
const RTU_BATCH_SIZE = 20
const MIN_BATCH_SIZE = 2

/**
 * Collect ALL leaf indexes from a tree (ignoring expansion state).
 */
function collectAllLeafIndexes(nodes: DebugTreeNode[]): Map<number, { compositeKey: string; type: string }> {
  const result = new Map<number, { compositeKey: string; type: string }>()

  function walk(node: DebugTreeNode) {
    if (node.isComplex && node.children) {
      for (const child of node.children) {
        walk(child)
      }
    } else if (node.debugIndex !== undefined) {
      result.set(node.debugIndex, { compositeKey: node.compositeKey, type: node.type })
    }
  }

  for (const node of nodes) {
    walk(node)
  }

  return result
}

export interface UseDebugPollingOptions {
  debugTreesRef: React.MutableRefObject<Record<string, DebugTreeNode[]>>
}

export function useDebugPolling({ debugTreesRef }: UseDebugPollingOptions): void {
  const debuggerPort = useDebugger()
  const isDebuggerVisible = useOpenPLCStore((state) => state.workspace.isDebuggerVisible)
  const { workspaceActions, consoleActions } = useOpenPLCStore()

  const pollingIntervalRef = useRef<number | null>(null)
  const staleCheckRef = useRef<number | null>(null)
  const lastResponseTimestampRef = useRef<number>(0)
  const batchOffsetRef = useRef(0)
  const isPollingRef = useRef(false)

  // Dynamic batch size — starts at max, halves on memory errors
  const batchSizeRef = useRef(DEFAULT_BATCH_SIZE)

  // Cached leaf index data — computed once when debugger starts, cleared when it stops.
  const cachedLeavesRef = useRef<Map<number, { compositeKey: string; type: string }> | null>(null)
  const cachedSortedIndexesRef = useRef<number[]>([])

  const getLeafData = useCallback(() => {
    if (cachedLeavesRef.current) {
      return { allLeaves: cachedLeavesRef.current, sortedIndexes: cachedSortedIndexesRef.current }
    }

    const allTrees = debugTreesRef.current
    const allLeaves = new Map<number, { compositeKey: string; type: string }>()
    for (const pouTrees of Object.values(allTrees)) {
      const leaves = collectAllLeafIndexes(pouTrees)
      for (const [index, meta] of leaves) {
        allLeaves.set(index, meta)
      }
    }

    if (allLeaves.size > 0) {
      cachedLeavesRef.current = allLeaves
      cachedSortedIndexesRef.current = Array.from(allLeaves.keys()).sort((a, b) => a - b)
    }

    return { allLeaves, sortedIndexes: cachedSortedIndexesRef.current }
  }, [debugTreesRef])

  /**
   * Poll one batch of variables from the runtime.
   */
  const pollVariables = useCallback(async () => {
    const { allLeaves, sortedIndexes } = getLeafData()
    if (allLeaves.size === 0) return

    let currentBatchSize = batchSizeRef.current

    // Clamp offset to valid range
    let batchOffset = batchOffsetRef.current
    if (batchOffset >= sortedIndexes.length) {
      batchOffset = 0
    }

    // Slice one batch from the current offset
    let batch = sortedIndexes.slice(batchOffset, batchOffset + currentBatchSize)

    // Request variables from runtime via debugger port
    let result = await debuggerPort.getVariablesList(batch)

    // Handle ERROR_OUT_OF_MEMORY with retry (halve batch size, same offset)
    while (!result.success && result.error === 'ERROR_OUT_OF_MEMORY' && currentBatchSize > MIN_BATCH_SIZE) {
      currentBatchSize = Math.max(MIN_BATCH_SIZE, Math.floor(currentBatchSize / 2))
      batchSizeRef.current = currentBatchSize
      consoleActions.addLog({
        id: crypto.randomUUID(),
        level: 'warning',
        message: `Reduced debug batch size to ${currentBatchSize} due to runtime memory error.`,
      })
      batch = sortedIndexes.slice(batchOffset, batchOffset + currentBatchSize)
      result = await debuggerPort.getVariablesList(batch)
    }

    if (!result.success) {
      return
    }

    // Update stale data tracking
    lastResponseTimestampRef.current = Date.now()
    workspaceActions.setDebugDataStale(false)

    // Parse response buffer → variable values
    let itemsProcessed = 0

    if (result.data && result.data.length > 0) {
      const responseBuffer = new Uint8Array(result.data)
      const newValues = new Map<string, string>()
      let bufferOffset = 0

      for (const index of batch) {
        const meta = allLeaves.get(index)
        if (!meta) continue

        const typeSize = getTypeSizeByName(meta.type)
        if (bufferOffset + typeSize > responseBuffer.length) break

        try {
          const { value, bytesRead } = parseValueByTypeName(responseBuffer, bufferOffset, meta.type)
          newValues.set(meta.compositeKey, value)
          bufferOffset += bytesRead
        } catch {
          newValues.set(meta.compositeKey, 'ERR')
          bufferOffset += typeSize
        }

        itemsProcessed++

        // Stop after the last variable the runtime was able to include
        if (result.lastIndex !== undefined && index >= result.lastIndex) break
      }

      // Merge new values into the store
      workspaceActions.setDebugVariableValues(newValues)
    }

    // Advance offset for next poll cycle (wraps around)
    if (itemsProcessed > 0) {
      batchOffsetRef.current = (batchOffset + itemsProcessed) % sortedIndexes.length
    }
  }, [debuggerPort, getLeafData, workspaceActions, consoleActions])

  // Ref-based poll so the interval never resets due to callback identity changes
  const pollRef = useRef(pollVariables)
  pollRef.current = pollVariables

  // Determine if current board is the simulator
  const isSimulatorBoard = useOpenPLCStore((state) => {
    const boardName = state.deviceDefinitions.configuration.deviceBoard
    const boardInfo = state.deviceAvailableOptions.availableBoards.get(boardName)
    return boardInfo?.compiler === 'simulator'
  })

  // Set up polling interval when debugger becomes visible.
  useEffect(() => {
    if (isDebuggerVisible) {
      // Reset state on session start
      batchSizeRef.current = isSimulatorBoard ? RTU_BATCH_SIZE : DEFAULT_BATCH_SIZE
      batchOffsetRef.current = 0
      lastResponseTimestampRef.current = 0

      const pollIntervalMs = isSimulatorBoard ? SIMULATOR_POLL_INTERVAL_MS : DEFAULT_POLL_INTERVAL_MS

      // Fire first poll immediately, then schedule at fixed rate
      // Skip tick if previous poll is still in progress (isPolling guard)
      isPollingRef.current = true
      void pollRef.current().finally(() => {
        isPollingRef.current = false
      })

      pollingIntervalRef.current = window.setInterval(() => {
        if (isPollingRef.current) return
        isPollingRef.current = true
        void pollRef.current().finally(() => {
          isPollingRef.current = false
        })
      }, pollIntervalMs)

      // Start stale data check (every 500ms, mark stale if no response for >2s)
      staleCheckRef.current = window.setInterval(() => {
        if (lastResponseTimestampRef.current > 0 && Date.now() - lastResponseTimestampRef.current > 2000) {
          workspaceActions.setDebugDataStale(true)
        }
      }, 500)

      return () => {
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current)
          pollingIntervalRef.current = null
        }
        if (staleCheckRef.current) {
          clearInterval(staleCheckRef.current)
          staleCheckRef.current = null
        }
      }
    } else {
      // Clean up when debugger is hidden (session ended)
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
        pollingIntervalRef.current = null
      }
      if (staleCheckRef.current) {
        clearInterval(staleCheckRef.current)
        staleCheckRef.current = null
      }
      cachedLeavesRef.current = null
      cachedSortedIndexesRef.current = []
      batchOffsetRef.current = 0
    }
  }, [isDebuggerVisible, isSimulatorBoard, workspaceActions])

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (staleCheckRef.current) {
        clearInterval(staleCheckRef.current)
        staleCheckRef.current = null
      }
    }
  }, [])
}
