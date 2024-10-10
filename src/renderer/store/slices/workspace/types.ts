import {
  PLCDataTypeSchema,
  PLCFunctionBlockSchema,
  PLCFunctionSchema,
  PLCInstanceSchema,
  PLCProgramSchema,
  PLCProjectDataSchema,
  PLCTaskSchema,
  PLCVariableSchema,
} from '@root/types/PLC/open-plc'
import { z } from 'zod'

const variableDTOSchema = z.object({
  scope: z.enum(['global', 'local']),
  associatedPou: z.string().optional(),
  data: PLCVariableSchema,
})
type VariableDTO = z.infer<typeof variableDTOSchema>

const pouDTOSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('program'),
    data: PLCProgramSchema,
  }),
  z.object({
    type: z.literal('function'),
    data: PLCFunctionSchema,
  }),
  z.object({
    type: z.literal('function-block'),
    data: PLCFunctionBlockSchema,
  }),
])
type PouDTO = z.infer<typeof pouDTOSchema>

const taskDTOSchema = z.object({
  data: PLCTaskSchema,
})

type TaskDTO = z.infer<typeof taskDTOSchema>

const instanceDTOSchema = z.object({
  data: PLCInstanceSchema,
})
type InstanceDTO = z.infer<typeof instanceDTOSchema>

const systemConfigsSchema = z.object({
  OS: z.enum(['win32', 'linux', 'darwin', '']),
  arch: z.enum(['x64', 'arm', '']),
  shouldUseDarkMode: z.boolean(),
  isWindowMaximized: z.boolean(),
})
type SystemConfigs = z.infer<typeof systemConfigsSchema>

const workspaceStateSchema = z.object({
  workspace: z.object({
    projectName: z.string(),
    projectPath: z.string(),
    projectData: PLCProjectDataSchema,
    editingState: z.enum(['save-request', 'saved', 'unsaved']),
    systemConfigs: systemConfigsSchema,
    recents: z.array(z.object({ lastOpenedAt: z.string(), createdAt: z.string(), path: z.string() })),
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
  setUserWorkspace: z
    .function()
    .args(workspaceStateSchema.shape.workspace.omit({ systemConfigs: true }))
    .returns(z.void()),
  setSystemConfigs: z.function().args(systemConfigsSchema).returns(z.void()),

  switchAppTheme: z.function().returns(z.void()),
  toggleMaximizedWindow: z.function().returns(z.void()),

  updateProjectName: z.function().args(z.string()).returns(z.void()),
  updateProjectPath: z.function().args(z.string()).returns(z.void()),

  createPou: z.function().args(pouDTOSchema).returns(workspaceResponseSchema),
  updatePou: z
    .function()
    .args(z.object({ name: z.string(), content: z.string() }))
    .returns(z.void()),
  deletePou: z.function().args(z.string()).returns(z.void()),

  createVariable: z
    .function()
    .args(variableDTOSchema.merge(z.object({ rowToInsert: z.number().optional() })))
    .returns(workspaceResponseSchema),
  updateVariable: z
    .function()
    .args(variableDTOSchema.omit({ data: true }).extend({ rowId: z.number(), data: PLCVariableSchema.partial() }))
    .returns(workspaceResponseSchema),
  deleteVariable: z
    .function()
    .args(variableDTOSchema.omit({ data: true }).merge(z.object({ rowId: z.number() })))
    .returns(z.void()),
  rearrangeVariables: z
    .function()
    .args(variableDTOSchema.omit({ data: true }).merge(z.object({ rowId: z.number(), newIndex: z.number() })))
    .returns(z.void()),

  createDatatype: z.function().args(PLCDataTypeSchema).returns(z.void()),
  createTask: z
    .function()
    .args(taskDTOSchema.merge(z.object({ rowToInsert: z.number().optional() })))
    .returns(z.void()),
  updateTask: z
    .function()
    .args(taskDTOSchema.merge(z.object({ rowId: z.number() })))
    .returns(z.void()),
  deleteTask: z
    .function()
    .args(z.object({ rowId: z.number() }))
    .returns(z.void()),
  rearrangeTasks: z
    .function()
    .args(z.object({ rowId: z.number(), newIndex: z.number() }))
    .returns(z.void()),
  createInstance: z
    .function()
    .args(instanceDTOSchema.merge(z.object({ rowToInsert: z.number().optional() })))
    .returns(z.void()),
  updateInstance: z
    .function()
    .args(instanceDTOSchema.merge(z.object({ rowId: z.number() })))
    .returns(z.void()),
  deleteInstance: z
    .function()
    .args(z.object({ rowId: z.number() }))
    .returns(z.void()),
  rearrangeInstances: z
    .function()
    .args(z.object({ rowId: z.number(), newIndex: z.number() }))
    .returns(z.void()),
})
type WorkspaceActions = z.infer<typeof workspaceActionsSchema>

type WorkspaceSlice = WorkspaceState & {
  workspaceActions: WorkspaceActions
}

export {
  pouDTOSchema,
  systemConfigsSchema,
  taskDTOSchema,
  variableDTOSchema,
  workspaceActionsSchema,
  workspaceResponseSchema,
  workspaceStateSchema,
}
export type {
  InstanceDTO,
  PouDTO,
  SystemConfigs,
  TaskDTO,
  VariableDTO,
  WorkspaceActions,
  WorkspaceResponse,
  WorkspaceSlice,
  WorkspaceState,
}
