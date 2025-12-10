import type { DebugTreeNode } from '@root/types/debugger'
import type { FbInstanceInfo } from '@root/types/debugger'
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
    isDebuggerVisible: z.boolean(),
    debuggerTargetIp: z.string().nullable(),
    debugVariableIndexes: z.custom<Map<string, number>>((val) => val instanceof Map),
    debugVariableValues: z.custom<Map<string, string>>((val) => val instanceof Map),
    debugForcedVariables: z.custom<Map<string, boolean>>((val) => val instanceof Map),
    debugVariableTree: z.custom<Map<string, DebugTreeNode>>((val) => val instanceof Map),
    debugExpandedNodes: z.custom<Map<string, boolean>>((val) => val instanceof Map),
    fbDebugInstances: z.custom<Map<string, FbInstanceInfo[]>>((val) => val instanceof Map),
    fbSelectedInstance: z.custom<Map<string, string>>((val) => val instanceof Map),
    isPlcLogsVisible: z.boolean(),
    plcLogs: z.string(),
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
  setDebuggerVisible: z.function().args(z.boolean()).returns(z.void()),
  setDebuggerTargetIp: z.function().args(z.string().nullable()).returns(z.void()),
  setDebugVariableIndexes: z.function().args(z.map(z.string(), z.number())).returns(z.void()),
  setDebugVariableValues: z.function().args(z.map(z.string(), z.string())).returns(z.void()),
  setDebugForcedVariables: z.function().args(z.map(z.string(), z.boolean())).returns(z.void()),
  setDebugVariableTree: z.function().args(z.map(z.string(), z.custom<DebugTreeNode>())).returns(z.void()),
  setDebugExpandedNodes: z.function().args(z.map(z.string(), z.boolean())).returns(z.void()),
  toggleDebugExpandedNode: z.function().args(z.string()).returns(z.void()),
  setFbDebugInstances: z
    .function()
    .args(z.map(z.string(), z.array(z.custom<FbInstanceInfo>())))
    .returns(z.void()),
  setFbSelectedInstance: z.function().args(z.string(), z.string()).returns(z.void()),
  clearFbDebugContext: z.function().returns(z.void()),
  setPlcLogsVisible: z.function().args(z.boolean()).returns(z.void()),
  setPlcLogs: z.function().args(z.string()).returns(z.void()),
  toggleDiscardChanges: z.function().returns(z.void()),
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
