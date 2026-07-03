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
 * Polling intervals:
 * - Modbus RTU / simulator: 50ms   (no network; keep the UI snappy)
 * - Web HTTP fallback:      1000ms  (WebRTC failed; each poll is a slow
 *                                    orchestrator round-trip, so back off)
 * - Everything else:        200ms   (general purpose — TCP / WebSocket /
 *                                    web WebRTC data channel)
 */

import { useCallback, useEffect, useRef } from 'react'

import type { DebugConnectionType, DebugTreeNode } from '../../middleware/shared/ports/types'
import { useCapabilities, useDebugger } from '../../middleware/shared/providers'
import { openPLCStoreBase, useOpenPLCStore } from '../store'
import { buildActiveIndexSet } from '../utils/debug-polling-filter'
import { applySwapToVariableBytes } from '../utils/endian'
import { getTypeSizeByName, parseValueByTypeName } from '../utils/variable-sizes'

/** Polling interval for transports with serial framing (RTU / simulator). */
const RTU_POLL_INTERVAL_MS = 50
/** Polling interval for higher-bandwidth transports (TCP / WebSocket). */
const DEFAULT_POLL_INTERVAL_MS = 200
/** Polling interval for the web HTTP fallback (WebRTC unavailable): each
 *  poll is a full orchestrator `run_command` round-trip, so we slow right
 *  down to avoid hammering the edge API / runtime. */
const HTTP_FALLBACK_POLL_INTERVAL_MS = 1000

// Batch size is transport-dependent. The wire request packs 3 bytes per
// variable (arr:u8 + elem:u16); the response packs raw type-sized values
// after a small header. The right ceiling is set by the transport's
// frame budget and the runtime's MAX_DEBUG_FRAME — never the target
// board, since the same board can run over RTU or TCP depending on the
// user's communication preferences.
//
// Modbus RTU             : capped at 19 so the REQUEST stays ≤63 bytes and
//                          fits in a single 64-byte USB-CDC packet. A 20-var
//                          request is 6 + 3·20 = 66 bytes, which a USB-CDC
//                          target (e.g. SAMD21 / P1AM-100) receives split
//                          across two USB packets; older firmware whose serial
//                          framer can't reassemble a multi-packet request then
//                          drops it. Newer firmware (length-aware handle_serial)
//                          handles any size, but 19 keeps us compatible with
//                          field devices on both. 19·3 + 6 = 63 ≤ 64.
// Modbus TCP             : Arduino sketch's MAX_MB_FRAME caps it; 60 is
//                          well within the headroom.
// WebSocket (Runtime v4) : Linux runtime's MAX_DEBUG_FRAME=4096; ~500
//                          vars fits comfortably with room for value
//                          bytes. Anything bigger is unusual and the
//                          ERROR_OUT_OF_MEMORY fallback halves us back
//                          down to a safe size.
// Simulator              : virtual serial port mirrors the RTU framing,
//                          so it shares the RTU ceiling.
const RTU_BATCH_SIZE = 19
const TCP_BATCH_SIZE = 60
const WEBSOCKET_BATCH_SIZE = 500
const MIN_BATCH_SIZE = 2

function batchSizeForTransport(transport: DebugConnectionType | null): number {
  switch (transport) {
    case 'websocket':
      return WEBSOCKET_BATCH_SIZE
    case 'rtu':
    case 'simulator':
      return RTU_BATCH_SIZE
    case 'tcp':
    case null:
    default:
      return TCP_BATCH_SIZE
  }
}

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
  // Web-only: which transport the debug session is actually running over.
  // 'http' means WebRTC is unavailable and every poll is a slow
  // orchestrator round-trip — so we back the cadence off (see below).
  // On the desktop editor this is the unused 'http' default; the
  // `!isNativeApplication` guard keeps the editor's real TCP/WebSocket
  // transports on the standard 200ms regardless.
  const sessionDebugTransport = useOpenPLCStore((state) => state.session.debugTransport)

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

  // Dynamic batch size — overwritten with the transport-specific
  // ceiling on session start; halves on ERROR_OUT_OF_MEMORY and
  // resets on the next session start.
  const batchSizeRef = useRef(TCP_BATCH_SIZE)

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
      let bufferOffset = 0

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
      let positionsConsumed = 0
      let loopReachedEnd = true
      for (let pos = 0; pos < batch.length; pos++) {
        if (result.lastIndex !== undefined && pos > result.lastIndex) {
          // Runtime processed fewer positions than the request; subsequent
          // slots are valid but unread by the runtime, so they are also
          // unread by us.  `positionsConsumed = pos` reflects exactly how
          // far the runtime got.
          loopReachedEnd = false
          break
        }

        const index = batch[pos]
        const metas = allLeaves.get(index)
        if (!metas || metas.length === 0) {
          // No leaf metadata — the runtime still consumed the position
          // (it doesn't know our index→type map).  Count it consumed and
          // press on; the value bytes for this slot are forfeit.
          positionsConsumed = pos + 1
          continue
        }

        // Every leaf at one index is the same underlying variable/address, so
        // they share type/size; parse once off the first, then fan the value
        // out to every composite key (a shared global lives under each POU's).
        const meta = metas[0]
        const typeSize = getTypeSizeByName(meta.type)
        if (bufferOffset + typeSize > responseBuffer.length) {
          // Response buffer ran out before we reached every position the
          // runtime claims to have processed.  Stop here; do NOT advance
          // past `pos`.  The next poll cycle retries from this same slot
          // (round-robin offset += positionsConsumed below) so variables
          // sitting at the tail of the active set still get their reads
          // — which is the entire reason this is structured around
          // `positionsConsumed` rather than `lastIndex+1`.
          loopReachedEnd = false
          break
        }

        const isBool = meta.type === 'BOOL'

        // Wire bytes arrive in the target's native byte order; the
        // internal codec below (parseValueByTypeName → DataView.getFloat32
        // with littleEndian=true) is LE-only.  Normalise here when
        // talking to a BE target.  No-op on LE (the common case).
        applySwapToVariableBytes(responseBuffer, bufferOffset, typeSize, meta.type, debugTargetEndian)

        try {
          const { value, bytesRead } = parseValueByTypeName(responseBuffer, bufferOffset, meta.type)
          // Translate enum integers to member names so every consumer
          // (watch panel, ladder, FBD, hover) reads the same display value.
          // Out-of-range falls back to the raw integer.
          const stored = meta.enumValues !== undefined ? (meta.enumValues[Number(value)] ?? value) : value
          const current = isBool ? currentBool : currentNonBool
          const changed = isBool ? changedBool : changedNonBool
          // Fan out to every composite key sharing this address (shared globals).
          for (const m of metas) {
            if (current.get(m.compositeKey) !== stored) changed.set(m.compositeKey, stored)
          }
          bufferOffset += bytesRead
        } catch {
          const changed = isBool ? changedBool : changedNonBool
          for (const m of metas) changed.set(m.compositeKey, 'ERR')
          bufferOffset += typeSize
        }
        positionsConsumed = pos + 1
      }

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

      // Only write to store when values actually changed
      if (changedBool.size > 0) workspaceActions.setDebugBoolValues(changedBool)
      if (changedNonBool.size > 0) workspaceActions.setDebugNonBoolValues(changedNonBool)
    }

    // Advance offset for next poll cycle (wraps around)
    if (itemsProcessed > 0) {
      batchOffsetRef.current = (batchOffset + itemsProcessed) % activeIndexes.length
    }
  }, [debuggerPort, getAllLeaves, workspaceActions, consoleActions])

  // Ref-based poll so the interval never resets due to callback identity changes
  const pollRef = useRef(pollVariables)
  pollRef.current = pollVariables

  // The transport in use for the current debug session. This drives both
  // the batch size and the poll interval — neither should be conditioned
  // on board target since the same board can speak RTU, TCP, etc. The
  // workspace activity bar sets this when the debug session connects.
  const debugConnectionType = useOpenPLCStore((state) => state.workspace.debugConnectionType)

  // Set up polling interval when debugger becomes visible.
  useEffect(() => {
    if (isDebuggerVisible) {
      // Reset state on session start
      batchSizeRef.current = batchSizeForTransport(debugConnectionType)
      batchOffsetRef.current = 0
      lastResponseTimestampRef.current = 0
      activeIndexesRef.current = null
      visibleVarsCacheRef.current = null

      // RTU framing also covers the simulator's virtual serial port —
      // both need the tighter cadence to keep up with toggling state.
      const usesRtuFraming = debugConnectionType === 'rtu' || debugConnectionType === 'simulator'
      // Web HTTP fallback: WebRTC unavailable, so reads go over the
      // orchestrator proxy (high latency) — slow the cadence right down.
      // Gated on `!isNativeApplication` so the desktop editor's real
      // TCP/WebSocket transports never hit this branch (their
      // `session.debugTransport` is an unused 'http' default).
      const usesHttpFallback = !capabilities.isNativeApplication && sessionDebugTransport === 'http'
      const pollIntervalMs = usesRtuFraming
        ? RTU_POLL_INTERVAL_MS
        : usesHttpFallback
          ? HTTP_FALLBACK_POLL_INTERVAL_MS
          : DEFAULT_POLL_INTERVAL_MS

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
    // `sessionDebugTransport` + `capabilities.isNativeApplication` are
    // in the deps so the cadence re-evaluates if WebRTC drops to the HTTP
    // fallback (or recovers) mid-session — the effect tears down the old
    // interval and restarts at the new rate.
  }, [
    isDebuggerVisible,
    debugConnectionType,
    sessionDebugTransport,
    capabilities.isNativeApplication,
    workspaceActions,
  ])

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
