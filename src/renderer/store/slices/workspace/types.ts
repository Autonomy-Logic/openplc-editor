import type { DebugVariableNode } from '@root/renderer/utils/parse-debug-file'
import { z } from 'zod'

const systemConfigsSchema = z.object({
  OS: z.enum(['win32', 'linux', 'darwin', '']),
  arch: z.enum(['x64', 'arm', '']),
  shouldUseDarkMode: z.boolean(),
  isWindowMaximized: z.boolean(),
})
type SystemConfigs = z.infer<typeof systemConfigsSchema>

const workspaceStateSchema = z.object({
  workspace: z.object({
    editingState: z.enum(['save-request', 'saved', 'unsaved', 'initial-state']),
    systemConfigs: systemConfigsSchema,
    recent: z.array(z.object({ lastOpenedAt: z.string(), createdAt: z.string(), path: z.string(), name: z.string() })),
    isCollapsed: z.boolean(),
    isModalOpen: z.array(z.object({ modalName: z.string(), modalState: z.boolean() })),
    discardChanges: z.boolean(),
    isDebuggerVisible: z.boolean(),
    debugVariableIndexes: z.custom<Map<string, number>>((val) => val instanceof Map),
    debugVariableValues: z.custom<Map<string, string>>((val) => val instanceof Map),
    debugVariableHierarchy: z.custom<Map<string, DebugVariableNode[]>>((val) => val instanceof Map),
    close: z.object({
      window: z.boolean(),
      app: z.boolean(),
      appDarwin: z.boolean(),
    }),
  }),
})
type WorkspaceState = z.infer<typeof workspaceStateSchema>

const workspaceResponseSchema = z.object({
  ok: z.boolean(),
  title: z.string().optional(),
  message: z.string().optional(),
})
type WorkspaceResponse = z.infer<typeof workspaceResponseSchema>

const workspaceActionsSchema = z.object({
  setEditingState: z.function().args(workspaceStateSchema.shape.workspace.shape.editingState).returns(z.void()),
  setRecent: z.function().args(workspaceStateSchema.shape.workspace.shape.recent).returns(z.void()),
  setSystemConfigs: z.function().args(systemConfigsSchema).returns(z.void()),
  setCloseWindow: z.function().args(z.boolean()).returns(z.void()),
  setCloseApp: z.function().args(z.boolean()).returns(z.void()),
  setCloseAppDarwin: z.function().args(z.boolean()).returns(z.void()),
  switchAppTheme: z.function().returns(z.void()),
  toggleMaximizedWindow: z.function().returns(z.void()),
  toggleCollapse: z.function().returns(z.void()),
  setModalOpen: z.function().args(z.string(), z.boolean()).returns(z.void()),
  setDebuggerVisible: z.function().args(z.boolean()).returns(z.void()),
  setDebugVariableIndexes: z.function().args(z.map(z.string(), z.number())).returns(z.void()),
  setDebugVariableValues: z.function().args(z.map(z.string(), z.string())).returns(z.void()),
  setDebugVariableHierarchy: z
    .function()
    .args(z.custom<Map<string, DebugVariableNode[]>>((val) => val instanceof Map))
    .returns(z.void()),
})
type WorkspaceActions = z.infer<typeof workspaceActionsSchema>

type WorkspaceSlice = WorkspaceState & {
  workspaceActions: WorkspaceActions
}

export { systemConfigsSchema, workspaceActionsSchema, workspaceResponseSchema, workspaceStateSchema }
export type { SystemConfigs, WorkspaceActions, WorkspaceResponse, WorkspaceSlice, WorkspaceState }
