import type { DebuggerPort } from '../../middleware/shared/ports/debugger-port'
import { useOpenPLCStore } from '../store'

/**
 * Force a variable to a specific value via the debug protocol, then update
 * the store's forced-variables Map on success.
 *
 * Uses `useOpenPLCStore.getState()` for imperative (non-hook) access so it is
 * safe to call from async event handlers without stale-closure issues.
 */
export async function forceDebugVariable(
  debuggerPort: DebuggerPort,
  compositeKey: string,
  debugIndex: number | undefined,
  valueBuffer: Uint8Array,
  forcedMapValue: boolean,
): Promise<boolean> {
  if (debugIndex === undefined) return false

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
