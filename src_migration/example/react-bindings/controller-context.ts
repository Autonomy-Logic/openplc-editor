import { createContext, useContext } from 'react'

import type { VariableListController } from '../contracts/presentation'

// The context carries the controller, a stable reference, never the changing model: no provider re-renders.
export const VariableListControllerContext = createContext<VariableListController | null>(null)

/** Reads the controller injected by `VariableListControllerProvider`; throws when the provider is missing. */
export function useVariableListController(): VariableListController {
  const controller = useContext(VariableListControllerContext)
  if (!controller) throw new Error('useVariableListController must be used inside VariableListControllerProvider')
  return controller
}
