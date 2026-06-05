import type { DebuggerPort } from '../../middleware/shared/ports/debugger-port'
import { useOpenPLCStore } from '../store'
import { applySwapToVariableBytes } from '../utils/endian'

/**
 * Force a variable to a specific value via the debug protocol, then update
 * the store's forced-variables Map on success.
 *
 * Uses `useOpenPLCStore.getState()` for imperative (non-hook) access so it is
 * safe to call from async event handlers without stale-closure issues.
 *
 * The optional `typeName` (canonical IEC, e.g. `'REAL'`, `'DINT'`) drives
 * the wire-endianness swap before the bytes leave the editor.  BOOL
 * force paths construct a one-byte buffer inline and don't need to
 * pass a type — the swap is a no-op on single bytes anyway.  STRING /
 * WSTRING buffers carry a length byte + raw bytes and are exempt from
 * swapping.
 */
export async function forceDebugVariable(
  debuggerPort: DebuggerPort,
  compositeKey: string,
  debugIndex: number | undefined,
  valueBuffer: Uint8Array,
  forcedMapValue: boolean,
  typeName?: string,
): Promise<boolean> {
  if (debugIndex === undefined) return false

  // Editor's internal codec produces LE bytes; swap to target-native
  // here if the target is BE.  No-op for LE targets and for
  // single-byte / string buffers.
  const { debugTargetEndian } = useOpenPLCStore.getState().workspace
  if (typeName !== undefined) {
    applySwapToVariableBytes(valueBuffer, 0, valueBuffer.length, typeName, debugTargetEndian)
  } else if (debugTargetEndian === 'be' && valueBuffer.length > 1) {
    // No type hint — apply a plain byte-reverse for safety.  Callers
    // that produce single-byte buffers (BOOL) hit the length guard
    // and skip; multi-byte buffers reach the runtime in target order.
    // String-like callers must pass `typeName` to opt out.
    applySwapToVariableBytes(valueBuffer, 0, valueBuffer.length, 'BYTES', debugTargetEndian)
  }

  const result = await debuggerPort.setVariable(debugIndex, true, valueBuffer)
  if (result.success) {
    const state = useOpenPLCStore.getState()
    const newForced = new Map(state.workspace.debugForcedVariables)
    newForced.set(compositeKey, forcedMapValue)
    state.workspaceActions.setDebugForcedVariables(newForced)
  }
  return result.success
}

/**
 * Release a forced variable via the debug protocol, then remove it from
 * the store's forced-variables Map on success.
 */
export async function releaseDebugVariable(
  debuggerPort: DebuggerPort,
  compositeKey: string,
  debugIndex: number | undefined,
): Promise<boolean> {
  if (debugIndex === undefined) return false

  const result = await debuggerPort.setVariable(debugIndex, false)
  if (result.success) {
    const state = useOpenPLCStore.getState()
    const newForced = new Map(state.workspace.debugForcedVariables)
    newForced.delete(compositeKey)
    state.workspaceActions.setDebugForcedVariables(newForced)
  }
  return result.success
}
