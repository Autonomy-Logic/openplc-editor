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
 * - Polls ONLY variables that are actively needed (watched, forced, graphed,
 *   visible on the active diagram, or referenced in ST/IL source text)
 * - Single-batch-per-cycle with round-robin offset
 * - Dynamic batch sizing (halves on ERROR_OUT_OF_MEMORY)
 * - lastIndex-aware advancement (runtime may return partial data)
 * - isPolling guard to skip tick if previous poll is in progress
 * - Diagram/source scan results are cached per {pouName, language, fbContext}
 *   since the editor is read-only during debug
 *
 * Batch size and poll interval both come from the session's medium — see
 * `DEBUG_MEDIUM_PROFILE`.
 */

import { useCallback, useEffect, useRef } from 'react'

import type { DebugTreeNode } from '../../middleware/shared/ports/types'
import { useCapabilities, useDebugger } from '../../middleware/shared/providers'
import { openPLCStoreBase, useOpenPLCStore } from '../store'
import { DEBUG_MEDIUM_PROFILE, debugProfileFor, DEFAULT_DEBUG_MEDIUM } from '../utils/debug-medium-profile'
import { buildActiveIndexSet } from '../utils/debug-polling-filter'
import { walkDebugResponse } from '../utils/debug-response-walker'

/**
 * Poll pacing and batching per medium now live in
 * `utils/debug-medium-profile`, so non-React callers (the headless CLI's debug
 * session) can size their reads from the same table. Re-exported here because
 * this module has been the import site for both since they were introduced.
 */
export { DEBUG_MEDIUM_PROFILE, debugProfileFor } from '../utils/debug-medium-profile'

/** Floor for the adaptive batch shrink below — a batch of one still makes progress. */
const MIN_BATCH_SIZE = 2

interface LeafMeta {
  compositeKey: string
  type: string
  /** Enum member names indexed by integer value, when the leaf is enum-typed. */
  enumValues?: string[]
}

/**
 * Collect ALL leaf metadata from a tree (ignoring expansion state), grouped by
 * debug index. Used to build the full index→metadata lookup for parsing
 * responses.
 *
 * One index can map to MANY composite keys: a shared CONFIGURATION VAR_GLOBAL is
 * referenced (as VAR_EXTERNAL) by every program that uses it, so `main:start_pb`
 * and `another_test:start_pb` resolve to the same address. The value read from
 * that address must fan out to every composite key, or the variable displays on
 * only one POU (the last one walked). Hence `LeafMeta[]` per index, not a single
 * `LeafMeta`.
 */
function collectAllLeafMeta(nodes: DebugTreeNode[]): Map<number, LeafMeta[]> {
  const result = new Map<number, LeafMeta[]>()

  function walk(node: DebugTreeNode) {
    if (node.isComplex && node.children) {
      for (const child of node.children) {
        walk(child)
      }
    } else if (node.debugIndex !== undefined) {
      const meta: LeafMeta = { compositeKey: node.compositeKey, type: node.type }
      if (node.enumValues) meta.enumValues = node.enumValues
      const existing = result.get(node.debugIndex)
      if (existing) existing.push(meta)
      else result.set(node.debugIndex, [meta])
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
  const capabilities = useCapabilities()
  const isDebuggerVisible = useOpenPLCStore((state) => state.workspace.isDebuggerVisible)
  const { workspaceActions, consoleActions } = useOpenPLCStore()

  // Targeted selectors for active-index cache invalidation.
  // These only change on user interaction (not every poll cycle).
  const pous = useOpenPLCStore(useCallback((s) => s.project.data.pous, []))
  const editorName = useOpenPLCStore(useCallback((s) => s.editor.meta.name, []))
  const debugForcedVariables = useOpenPLCStore(useCallback((s) => s.workspace.debugForcedVariables, []))
  const debugExpandedNodes = useOpenPLCStore(useCallback((s) => s.workspace.debugExpandedNodes, []))
  const debugGraphList = useOpenPLCStore(useCallback((s) => s.workspace.debugGraphList, []))
  const fbSelectedInstance = useOpenPLCStore(useCallback((s) => s.workspace.fbSelectedInstance, []))

  const pollingIntervalRef = useRef<number | null>(null)
  const staleCheckRef = useRef<number | null>(null)
  const lastResponseTimestampRef = useRef<number>(0)
  const batchOffsetRef = useRef(0)
  const isPollingRef = useRef(false)

  // Dynamic batch size — overwritten with the medium's ceiling on session start;
  // halves on ERROR_OUT_OF_MEMORY and resets on the next session start.
  const batchSizeRef = useRef(DEBUG_MEDIUM_PROFILE[DEFAULT_DEBUG_MEDIUM].batchSize)

  // Full leaf index→metadata map — computed once when debugger starts.
  // One index → many leaves (a shared global appears under each POU's key).
  const allLeavesRef = useRef<Map<number, LeafMeta[]> | null>(null)

  // Cached active indexes — rebuilt only when invalidation triggers change.
  const activeIndexesRef = useRef<number[] | null>(null)

  // Cache for diagram/source-visible variable scan results.
  // Keyed by {pouName, language, fbContextKey}. Invalidated on POU/FB switch.
  const visibleVarsCacheRef = useRef<{
    pouName: string
    language: string
    fbContextKey: string
    keys: Set<string>
  } | null>(null)

  // Invalidate active index cache when any input changes
  useEffect(() => {
    activeIndexesRef.current = null
    visibleVarsCacheRef.current = null
  }, [pous, editorName, debugForcedVariables, debugExpandedNodes, debugGraphList, fbSelectedInstance])

  /** Build the full leaf metadata map from all debug trees (once per session). */
  const getAllLeaves = useCallback(() => {
    if (allLeavesRef.current) return allLeavesRef.current

    const allTrees = debugTreesRef.current
    const allLeaves = new Map<number, LeafMeta[]>()
    for (const pouTrees of Object.values(allTrees)) {
      const leaves = collectAllLeafMeta(pouTrees)
      for (const [index, metas] of leaves) {
        const existing = allLeaves.get(index)
        if (existing) existing.push(...metas)
        else allLeaves.set(index, [...metas])
      }
    }

    if (allLeaves.size > 0) {
      allLeavesRef.current = allLeaves
    }

    return allLeaves
  }, [debugTreesRef])

  /**
   * Poll one batch of variables from the runtime.
   */
  const pollVariables = useCallback(async () => {
    const allLeaves = getAllLeaves()
    if (allLeaves.size === 0) return

    // Use cached active indexes — only rebuild when invalidation triggers change
    if (!activeIndexesRef.current) {
      const state = openPLCStoreBase.getState()
      const { activeIndexes, cacheResult } = buildActiveIndexSet(state, allLeaves, visibleVarsCacheRef.current)
      if (cacheResult !== visibleVarsCacheRef.current) {
        visibleVarsCacheRef.current = cacheResult
      }
      activeIndexesRef.current = activeIndexes
    }

    const activeIndexes = activeIndexesRef.current
    if (activeIndexes.length === 0) return

    let currentBatchSize = batchSizeRef.current

    // Clamp offset to valid range
    let batchOffset = batchOffsetRef.current
    if (batchOffset >= activeIndexes.length) {
      batchOffset = 0
    }

    // Slice one batch from the current offset
    let batch = activeIndexes.slice(batchOffset, batchOffset + currentBatchSize)

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
      batch = activeIndexes.slice(batchOffset, batchOffset + currentBatchSize)
      result = await debuggerPort.getVariablesList(batch)
    }

    if (!result.success) {
      return
    }

    // Update stale data tracking
    lastResponseTimestampRef.current = Date.now()
    if (openPLCStoreBase.getState().workspace.debugDataStale) {
      workspaceActions.setDebugDataStale(false)
    }

    // Parse response buffer → variable values
    let itemsProcessed = 0

    if (result.data && result.data.length > 0) {
      const responseBuffer = new Uint8Array(result.data)
      const {
        debugBoolValues: currentBool,
        debugNonBoolValues: currentNonBool,
        debugTargetEndian,
      } = openPLCStoreBase.getState().workspace
      const changedBool = new Map<string, string>()
      const changedNonBool = new Map<string, string>()

      // Wire format note: result.lastIndex is the runtime's last_req_idx —
      // a 0-based POSITION INTO THE REQUEST LIST, not a variable index.
      // Iterate by position so the comparison and the offset advancement
      // both interpret it correctly. Without this, batches with high
      // variable IDs trip `index >= lastIndex` on the first entry and
      // collapse the throughput to one variable per poll, which makes
      // related variables visibly desync as the round-robin sweeps.
      //
      // `loopReachedEnd` records whether the loop walked the full batch
      // before exiting.  The early-exit paths below (bounds check, lastIndex
      // cap) leave `pos` pointing at the FIRST unprocessed slot, so we
      // capture that to advance the round-robin offset by exactly the
      // positions the editor actually consumed.  See the offset-advancement
      // block below this loop for why naive use of `lastIndex+1` strands
      // the tail of the active set.
      // The positional walk itself lives in `utils/debug-response-walker`, shared
      // with the headless CLI's debug session: `lastIndex` handling, the
      // consumed-but-undecodable slot, the short-buffer stop and the endian swap
      // are all silent-corruption bugs when they differ between callers. What
      // stays here is what is genuinely this caller's: enum member names and the
      // fan-out to every composite key sharing an address.
      const walk = walkDebugResponse({
        requested: batch,
        payload: responseBuffer,
        lastIndex: result.lastIndex,
        endian: debugTargetEndian,
        typeOf: (index) => {
          const metas = allLeaves.get(index)
          // Every leaf at one index is the same underlying variable/address, so
          // they share type/size.
          return metas && metas.length > 0 ? metas[0].type : undefined
        },
        emit: ({ index, type, value }) => {
          const metas = allLeaves.get(index)
          /* istanbul ignore if -- typeOf already resolved metadata for this index */
          if (!metas || metas.length === 0) return
          // Translate enum integers to member names so every consumer (watch
          // panel, ladder, FBD, hover) reads the same display value.
          // Out-of-range falls back to the raw integer.
          const enumValues = metas[0].enumValues
          const stored = enumValues !== undefined ? (enumValues[Number(value)] ?? value) : value
          const changed = type === 'BOOL' ? changedBool : changedNonBool
          const current = type === 'BOOL' ? currentBool : currentNonBool
          for (const m of metas) {
            if (current.get(m.compositeKey) !== stored) changed.set(m.compositeKey, stored)
          }
        },
        onError: ({ index, type }) => {
          const metas = allLeaves.get(index)
          /* istanbul ignore if -- typeOf already resolved metadata for this index */
          if (!metas || metas.length === 0) return
          const changed = type === 'BOOL' ? changedBool : changedNonBool
          for (const m of metas) changed.set(m.compositeKey, 'ERR')
        },
      })
      const positionsConsumed = walk.positionsConsumed
      const loopReachedEnd = walk.reachedEnd

      // Advance round-robin offset by what we actually consumed.
      //
      // Why not `lastIndex + 1`: the runtime reports how many positions
      // IT touched, but if the response buffer truncated before we read
      // them all (or if we broke out for any other reason) the editor's
      // consumption is smaller.  Using `lastIndex+1` then strands every
      // position past the truncation point — the offset wraps past the
      // tail of `activeIndexes` and the next poll restarts at 0, never
      // covering the dropped positions.  This was the root cause of
      // "forced REAL at the tail of the active set reads as `-`": batch
      // size 60 against an active set of 20 sent every poll as one shot,
      // the response truncated short of position 19 (pid_tr), the offset
      // advanced past 19 anyway, and pid_tr was unreachable for the life
      // of the session.
      //
      // When the loop walked the full batch with no break, fall through
      // to runtime's lastIndex+1 so positions the runtime skipped
      // (var_size == 0, e.g. STRING stubs) still advance us.  Otherwise
      // honor positionsConsumed so unread positions get retried.
      if (loopReachedEnd) {
        itemsProcessed = result.lastIndex !== undefined ? Math.min(result.lastIndex + 1, batch.length) : batch.length
      } else {
        itemsProcessed = positionsConsumed
      }

      // Only write to store when values actually changed — one commit per poll cycle
      if (changedBool.size > 0 || changedNonBool.size > 0) {
        workspaceActions.setDebugValues({ boolValues: changedBool, nonBoolValues: changedNonBool })
      }
    }

    // Advance offset for next poll cycle (wraps around)
    if (itemsProcessed > 0) {
      batchOffsetRef.current = (batchOffset + itemsProcessed) % activeIndexes.length
    }
  }, [debuggerPort, getAllLeaves, workspaceActions, consoleActions])

  // Ref-based poll so the interval never resets due to callback identity changes
  const pollRef = useRef(pollVariables)
  pollRef.current = pollVariables

  // The medium this session is actually riding, published by the connection
  // manager — the one place that knows. Read LIVE rather than latched at session
  // start, because on web it can change mid-session: a WebRTC data channel that
  // drops falls back to the Edge relay, and the cadence has to follow it down.
  const debugMedium = useOpenPLCStore((state) => state.deviceConnection.debugTransport)

  // Set up polling interval when debugger becomes visible.
  useEffect(() => {
    if (isDebuggerVisible) {
      const profile = debugProfileFor(debugMedium)

      // Reset state on session start
      batchSizeRef.current = profile.batchSize
      batchOffsetRef.current = 0
      lastResponseTimestampRef.current = 0
      activeIndexesRef.current = null
      visibleVarsCacheRef.current = null

      // One lookup, both axes. The medium already distinguishes a peer-to-peer
      // data channel from the Edge relay, so nothing here needs to ask which
      // platform it is running on.
      const pollIntervalMs =
        debugMedium === 'http-relay' ? capabilities.debugRelayPollIntervalMs : profile.pollIntervalMs

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
      allLeavesRef.current = null
      visibleVarsCacheRef.current = null
      batchOffsetRef.current = 0
    }
    // `debugMedium` is in the deps so the cadence re-evaluates when a WebRTC data
    // channel drops to the Edge relay (or recovers) mid-session — the effect tears
    // down the old interval and restarts at the new rate.
  }, [isDebuggerVisible, debugMedium, capabilities.debugRelayPollIntervalMs, workspaceActions])

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
