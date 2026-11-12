import type { WorkspaceState } from './types'

export const selectIsEditingLocked = (state: WorkspaceState): boolean => state.workspace.isDebuggerVisible
