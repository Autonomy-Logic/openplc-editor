import {
  bodySchema,
  PLCDataTypeSchema,
  PLCFunctionBlockSchema,
  PLCFunctionSchema,
  PLCInstanceSchema,
  PLCProgramSchema,
  PLCProjectDataSchema,
  PLCStructureVariableSchema,
  PLCTaskSchema,
  PLCVariableSchema,
} from '@root/types/PLC/open-plc'
import { z } from 'zod'

/**
 * =====================================
 * DTO Schemas
 * =====================================
 */

/**
 * variableDTOSchema
 * - This schema is used to define the DTO for the variable
 * - The variable DTO contains the scope, associatedPou, and the data
 */
const variableDTOSchema = z.object({
  scope: z.enum(['global', 'local']),
  associatedPou: z.string().optional(),
  data: PLCVariableSchema,
})

const structureVariableDTOSchema = z.object({
  associatedDataType: z.string().optional(),
  data: PLCStructureVariableSchema,
})
type VariableDTO = z.infer<typeof variableDTOSchema>

const dataTypeDTOSchema = z.object({
  data: PLCDataTypeSchema,
})

type DataTypeDTO = z.infer<typeof dataTypeDTOSchema>
/**
 * pouDTOSchema
 * - This schema is used to define the DTO for the POU
 * - The POU DTO contains the type and the data
 * - The type can be program, function, or function-block
 */
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

/**
 * taskDTOSchema
 * - This schema is used to define the DTO for the task
 */
const taskDTOSchema = z.object({
  data: PLCTaskSchema,
})

type TaskDTO = z.infer<typeof taskDTOSchema>

/**
 * instanceDTOSchema
 * - This schema is used to define the DTO for the instance
 */
const instanceDTOSchema = z.object({
  data: PLCInstanceSchema,
})
type InstanceDTO = z.infer<typeof instanceDTOSchema>

/**
 * =====================================
 * Project Slice Schemas
 * =====================================
 */

/**
 * Project Meta Schema
 */
const projectMetaSchema = z.object({
  name: z.string(),
  type: z.enum(['plc-project', 'plc-library']),
  path: z.string(),
})
type ProjectMeta = z.infer<typeof projectMetaSchema>

/**
 * Project State Schema
 * - This schema is used to define the state of the project slice
 * - It contains the meta information of the project and the project data
 * - The project data is defined by the PLCProjectDataSchema
 *   - The project data contains the data types, pous, and configuration
 */
const projectStateSchema = z.object({
  meta: projectMetaSchema,
  data: PLCProjectDataSchema,
})
type ProjectState = z.infer<typeof projectStateSchema>

/**
 * Project Response Schema
 * - This schema is used to define the response of the project slice
 */
const projectResponseSchema = z.object({
  ok: z.boolean(),
  title: z.string().optional(),
  message: z.string().optional(),
  data: z.unknown().optional(),
})
type ProjectResponse = z.infer<typeof projectResponseSchema>

/**
 * Project Action Schema
 * - This schema is used to define the actions that can be performed on the project slice
 */
const _projectActionsSchema = z.object({
  /**
   * Update/Set Project state
   */
  setProject: z.function().args(projectStateSchema).returns(z.void()),
  clearProjects: z.function().args(z.void()).returns(z.void()),

  /**
   * Meta Actions
   */
  updateMetaName: z.function().args(z.string()).returns(z.void()),
  updateMetaPath: z.function().args(z.string()).returns(z.void()),

  /**
   * POU Actions
   */
  createPou: z.function().args(pouDTOSchema).returns(projectResponseSchema),
  updatePou: z
    .function()
    .args(z.object({ name: z.string(), content: bodySchema }))
    .returns(z.void()),
  deletePou: z.function().args(z.string()).returns(z.void()),
  updatePouDocumentation: z.function().args(z.string(), z.string()).returns(z.void()),
  updatePouReturnType: z.function().args(z.string(), z.string()).returns(z.void()),

  /**
   * Variables Table Actions
   */
  createVariable: z
    .function()
    .args(variableDTOSchema.merge(z.object({ rowToInsert: z.number().optional() })))
    .returns(projectResponseSchema),
  updateVariable: z
    .function()
    .args(
      variableDTOSchema
        .omit({ data: true })
        .extend({ rowId: z.number().optional(), variableId: z.string().optional(), data: PLCVariableSchema.partial() }),
    )
    .returns(projectResponseSchema),
  getVariable: z
    .function()
    .args(
      variableDTOSchema
        .omit({ data: true })
        .merge(z.object({ rowId: z.number().optional(), variableId: z.string().optional() })),
    )
    .returns(PLCVariableSchema.or(PLCVariableSchema.omit({ class: true })).optional()),
  deleteVariable: z
    .function()
    .args(
      variableDTOSchema
        .omit({ data: true })
        .merge(z.object({ rowId: z.number().optional(), variableId: z.string().optional() })),
    )
    .returns(z.void()),
  rearrangeVariables: z
    .function()
    .args(
      variableDTOSchema
        .omit({ data: true })
        .merge(z.object({ rowId: z.number().optional(), variableId: z.string().optional(), newIndex: z.number() })),
    )
    .returns(z.void()),

  /**
   * Data Type Actions
   */
  createDatatype: z
    .function()
    .args(dataTypeDTOSchema.merge(z.object({ rowToInsert: z.number().optional() })))
    .returns(projectResponseSchema),
  deleteDatatype: z.function().args(z.string()).returns(z.void()),
  updateDatatype: z.function().args(z.string(), PLCDataTypeSchema.optional()).returns(z.void()),
  createArrayDimension: z
    .function()
    .args(z.object({ name: z.string(), derivation: z.enum(['array', 'enumerated', 'structure']) })),
  rearrangeStructureVariables: z
    .function()
    .args(structureVariableDTOSchema.omit({ data: true }).merge(z.object({ rowId: z.number(), newIndex: z.number() })))
    .returns(z.void()),

  /**
   * Task Actions
   */
  createTask: z
    .function()
    .args(taskDTOSchema.merge(z.object({ rowToInsert: z.number().optional() })))
    .returns(projectResponseSchema),
  updateTask: z
    .function()
    .args(taskDTOSchema.merge(z.object({ rowId: z.number() })))
    .returns(projectResponseSchema),
  deleteTask: z
    .function()
    .args(z.object({ rowId: z.number() }))
    .returns(z.void()),
  rearrangeTasks: z
    .function()
    .args(z.object({ rowId: z.number(), newIndex: z.number() }))
    .returns(z.void()),

  /**
   * Instance Actions
   */
  createInstance: z
    .function()
    .args(instanceDTOSchema.merge(z.object({ rowToInsert: z.number().optional() })))
    .returns(projectResponseSchema),
  updateInstance: z
    .function()
    .args(instanceDTOSchema.merge(z.object({ rowId: z.number() })))
    .returns(projectResponseSchema),
  deleteInstance: z
    .function()
    .args(z.object({ rowId: z.number() }))
    .returns(z.void()),
  rearrangeInstances: z
    .function()
    .args(z.object({ rowId: z.number(), newIndex: z.number() }))
    .returns(z.void()),
})
type ProjectActions = z.infer<typeof _projectActionsSchema>

/**
 * Project Slice
 * - This type is used to define the project slice
 */
type ProjectSlice = {
  project: ProjectState
  projectActions: ProjectActions
}

export { projectMetaSchema, projectResponseSchema, projectStateSchema }

export {
  DataTypeDTO,
  InstanceDTO,
  PouDTO,
  ProjectMeta,
  ProjectResponse,
  ProjectSlice,
  ProjectState,
  TaskDTO,
  VariableDTO,
}
