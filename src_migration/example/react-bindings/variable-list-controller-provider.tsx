import type { ReactNode } from 'react'

import type { VariableListController } from '../contracts/presentation'
import { VariableListControllerContext } from './controller-context'

export interface VariableListControllerProviderProps {
  readonly controller: VariableListController
  readonly children: ReactNode
}

/** Dependency injection point for React: `composition` decides which controller (real or fixture) goes in. */
export function VariableListControllerProvider({ controller, children }: VariableListControllerProviderProps) {
  return <VariableListControllerContext.Provider value={controller}>{children}</VariableListControllerContext.Provider>
}
