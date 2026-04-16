import { useCallback } from 'react'
import { useShallow } from 'zustand/react/shallow'

import { useOpenPLCStore } from '../store'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DebugVariableState {
  value: string | undefined
  isForced: boolean
  forcedValue: boolean | undefined
  debugIndex: number | undefined
}

// ---------------------------------------------------------------------------
// Scalar selectors (no key dependency)
// ---------------------------------------------------------------------------

/** Subscribe only to the global debugger-visible flag. */
export function useIsDebuggerVisible(): boolean {
  return useOpenPLCStore(useCallback((s) => s.workspace.isDebuggerVisible, []))
}

// ---------------------------------------------------------------------------
// Per-key selectors (re-render only when THIS key's value changes)
// ---------------------------------------------------------------------------

/**
 * Polled debug value for a single composite key.
 * Checks both BOOL and non-BOOL maps — Zustand's Object.is comparison on the
 * returned string means unchanged keys skip re-render even when a Map reference changes.
 */
export function useDebugVariableValue(compositeKey: string): string | undefined {
  return useOpenPLCStore(
    useCallback(
      (s) => s.workspace.debugBoolValues.get(compositeKey) ?? s.workspace.debugNonBoolValues.get(compositeKey),
      [compositeKey],
    ),
  )
}

/** Whether a variable is currently forced. */
export function useIsVariableForced(compositeKey: string): boolean {
  return useOpenPLCStore(useCallback((s) => s.workspace.debugForcedVariables.has(compositeKey), [compositeKey]))
}

/** The forced boolean value (true = forced high, false = forced low). */
export function useForcedValue(compositeKey: string): boolean | undefined {
  return useOpenPLCStore(useCallback((s) => s.workspace.debugForcedVariables.get(compositeKey), [compositeKey]))
}

/** The protocol index for force/release transport. */
export function useDebugVariableIndex(compositeKey: string): number | undefined {
  return useOpenPLCStore(useCallback((s) => s.workspace.debugVariableIndexes.get(compositeKey), [compositeKey]))
}

// ---------------------------------------------------------------------------
// Composite per-key selector (single subscription, shallow equality)
// ---------------------------------------------------------------------------

/**
 * All debug state for a single variable in one subscription.
 * Uses shallow equality so the component only re-renders when one of the
 * four values actually changes — not on every polling cycle.
 */
export function useDebugValue(compositeKey: string): DebugVariableState {
  return useOpenPLCStore(
    useShallow((s) => ({
      value: s.workspace.debugBoolValues.get(compositeKey) ?? s.workspace.debugNonBoolValues.get(compositeKey),
      isForced: s.workspace.debugForcedVariables.has(compositeKey),
      forcedValue: s.workspace.debugForcedVariables.get(compositeKey),
      debugIndex: s.workspace.debugVariableIndexes.get(compositeKey),
    })),
  )
}

// ---------------------------------------------------------------------------
// Map-level selectors (for containers that iterate all values)
// ---------------------------------------------------------------------------

/** BOOL values Map — for canvas containers that only need BOOL for edge coloring. */
export function useDebugBoolValuesMap(): Map<string, string> {
  return useOpenPLCStore(useCallback((s) => s.workspace.debugBoolValues, []))
}

/** Non-BOOL values Map — for display panels that need non-BOOL values (charts, monaco, sidebar). */
export function useDebugNonBoolValuesMap(): Map<string, string> {
  return useOpenPLCStore(useCallback((s) => s.workspace.debugNonBoolValues, []))
}

/** Full forced Map — use only in container components that need to iterate all keys. */
export function useDebugForcedVariablesMap(): Map<string, boolean> {
  return useOpenPLCStore(useCallback((s) => s.workspace.debugForcedVariables, []))
}
