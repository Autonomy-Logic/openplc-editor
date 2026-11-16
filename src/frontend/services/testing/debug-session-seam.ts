import type { OpenPLCStore } from '../../store'
import { selectIsEditingLocked } from '../../store/slices/workspace/selectors'

export const DEBUG_SESSION_SEAM_GLOBAL = '__OPENPLC_E2E_DEBUG_SESSION__'

export interface DebugSessionSeam {
  open(): void
  close(): void
  isOpen(): boolean
}

export function installDebugSessionSeam(store: OpenPLCStore, target: object): DebugSessionSeam {
  const seam: DebugSessionSeam = {
    open: () => store.getState().workspaceActions.setDebuggerVisible(true),
    close: () => store.getState().workspaceActions.clearDebugState(),
    isOpen: () => selectIsEditingLocked(store.getState()),
  }

  Reflect.set(target, DEBUG_SESSION_SEAM_GLOBAL, seam)

  return seam
}
