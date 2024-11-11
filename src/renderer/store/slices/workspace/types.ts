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
    editingState: z.enum(['save-request', 'saved', 'unsaved']),
    systemConfigs: systemConfigsSchema,
    recents: z.array(z.object({ lastOpenedAt: z.string(), createdAt: z.string(), path: z.string() })),
    isCollapsed: z.boolean(),
    isModalOpen: z.array(z.object({ modalName: z.string(), modalState: z.boolean() })),
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
  setRecents: z.function().args(workspaceStateSchema.shape.workspace.shape.recents).returns(z.void()),
  setSystemConfigs: z.function().args(systemConfigsSchema).returns(z.void()),

  switchAppTheme: z.function().returns(z.void()),
  toggleMaximizedWindow: z.function().returns(z.void()),
  toggleCollapse: z.function().returns(z.void()),
  setModalOpen: z.function().args(z.string(), z.boolean()).returns(z.void()),
})
type WorkspaceActions = z.infer<typeof workspaceActionsSchema>

type WorkspaceSlice = WorkspaceState & {
  workspaceActions: WorkspaceActions
}

export { systemConfigsSchema, workspaceActionsSchema, workspaceResponseSchema, workspaceStateSchema }
export type { SystemConfigs, WorkspaceActions, WorkspaceResponse, WorkspaceSlice, WorkspaceState }
