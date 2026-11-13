import type { DebugTreeNode } from '../../../middleware/shared/ports/types'
import type { OpenPLCStore } from '../../store'
import { selectIsEditingLocked } from '../../store/slices/workspace/selectors'

export const DEBUG_SESSION_SEAM_GLOBAL = '__OPENPLC_E2E_DEBUG_SESSION__'

export interface DebugSessionSeam {
  open(): void
  close(): void
  isOpen(): boolean
  publishVariables(nodes: DebugTreeNode[], indexes?: Record<string, number>): void
}

export function installDebugSessionSeam(store: OpenPLCStore, target: object): DebugSessionSeam {
  const seam: DebugSessionSeam = {
    open: () => store.getState().workspaceActions.setDebuggerVisible(true),
    close: () => store.getState().workspaceActions.clearDebugState(),
    isOpen: () => selectIsEditingLocked(store.getState()),
    publishVariables: (nodes, indexes) => {
      const actions = store.getState().workspaceActions
      actions.setDebugVariableTree(new Map(nodes.map((node) => [node.compositeKey, node])))
      actions.setDebugVariableIndexes(new Map(Object.entries(indexes ?? {})))
    },
  }

  Reflect.set(target, DEBUG_SESSION_SEAM_GLOBAL, seam)

  return seam
}
