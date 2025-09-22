import { z } from 'zod'

const workspaceProjectTreeLeafSchema = z
  .enum(['function', 'function-block', 'program', 'data-type', 'device', 'resource'])
  .nullable()
type WorkspaceProjectTreeLeafType = z.infer<typeof workspaceProjectTreeLeafSchema>

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
    close: z.object({
      window: z.boolean(),
      app: z.boolean(),
      appDarwin: z.boolean(),
    }),
    selectedProjectTreeLeaf: z.object({
      label: z.string(),
      type: workspaceProjectTreeLeafSchema,
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
  setSelectedProjectTreeLeaf: z
    .function()
    .args(
      z.object({
        label: z.string(),
        type: workspaceProjectTreeLeafSchema,
      }),
    )
    .returns(z.void()),
  clearWorkspace: z.function().returns(z.void()),
})
type WorkspaceActions = z.infer<typeof workspaceActionsSchema>

type WorkspaceSlice = WorkspaceState & {
  workspaceActions: WorkspaceActions
}

export {
  systemConfigsSchema,
  workspaceActionsSchema,
  workspaceProjectTreeLeafSchema,
  workspaceResponseSchema,
  workspaceStateSchema,
}
export type {
  SystemConfigs,
  WorkspaceActions,
  WorkspaceProjectTreeLeafType,
  WorkspaceResponse,
  WorkspaceSlice,
  WorkspaceState,
}
