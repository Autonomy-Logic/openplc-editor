import { z } from 'zod'

const baseTypeSchema = z.enum([
  'bool',
  'sint',
  'int',
  'dint',
  'lint',
  'usint',
  'uint',
  'udint',
  'ulint',
  'real',
  'lreal',
  'time',
  'date',
  'tod',
  'dt',
  'string',
  'byte',
  'word',
  'dword',
  'lword',
  'loglevel',
])
type BaseType = z.infer<typeof baseTypeSchema>

const PLCDataTypeStructureElementSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  type: z.discriminatedUnion('definition', [
    z.object({
      definition: z.literal('base-type'),
      value: z.string(),
    }),
    z.object({
      definition: z.literal('array'),
      value: z.string(),
      data: z.object({
        baseType: baseTypeSchema,
        dimensions: z.array(z.string()),
      }),
    }),
  ]),
  initialValue: z.string().optional(),
})
type PLCDataTypeStructureElement = z.infer<typeof PLCDataTypeStructureElementSchema>

const PLCDataTypeDerivationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('array'),
    value: z.string(),
    data: z.object({
      baseType: baseTypeSchema,
      dimensions: z.array(z.string()),
    }),
    initialValue: z.string(),
  }),
  /** This enumerated needs to be reviewed */
  z.object({
    type: z.literal('enumerated'),
    values: z.array(z.string()),
    /** The initial value must be one of the values created */
    initialValue: z.string(),
  }),
  /** This structure needs to be reviewed */
  z.object({
    type: z.literal('structure'),
    elements: z.array(PLCDataTypeStructureElementSchema),
  }),
])

const PLCDataTypeSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  derivation: PLCDataTypeDerivationSchema,
})

type PLCDataType = z.infer<typeof PLCDataTypeSchema>

const PLCVariableSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  class: z.enum(['input', 'output', 'inOut', 'external', 'local', 'temp', 'global']).optional(),
  type: z.discriminatedUnion('definition', [
    z.object({
      definition: z.literal('base-type'),
      value: baseTypeSchema,
    }),
    z.object({
      definition: z.literal('user-data-type'),
      /** In fact this will be filled by the data types created by the user
       *  This is a mock type just for a presentation.
       * @deprecated
       */
      value: z.enum(['userDt1', 'userDt2', 'userDt3']),
    }),
    z.object({
      definition: z.literal('array'),
      value: z.string(),
      data: z.object({
        /** This must also include the data types created by the user */
        baseType: baseTypeSchema,
        dimensions: z.array(z.string()),
      }),
    }),
  ]),
  location: z.string(),
  // initialValue: z.string().optional(),
  documentation: z.string(),
  debug: z.boolean(),
})

type PLCVariable = z.infer<typeof PLCVariableSchema>
const PLCGlobalVariableSchema = PLCVariableSchema.omit({ class: true })
type PLCGlobalVariable = z.infer<typeof PLCGlobalVariableSchema>

const PLCTaskSchema = z.object({
  id: z.string().optional(),
  name: z.string(), // TODO: This should be homologate. Concept: An unique identifier for the task object.
  triggering: z.enum(['Cyclic', 'Interrupt']),
  interval: z.string(), // TODO: Must have a regex validation for this. Probably a new modal must be created to handle this.
  priority: z.number(), // TODO: implement this validation. This must be a positive integer from 0 to 100
})

type PLCTask = z.infer<typeof PLCTaskSchema>

const PLCFunctionSchema = z.object({
  language: z.enum(['il', 'st', 'ld', 'sfc', 'fbd']),
  name: z.string(),
  returnType: z.enum(['BOOL', 'INT', 'DINT']),
  /** Array of variable - will be implemented */
  variables: z.array(PLCVariableSchema),
  body: z.string(),
  documentation: z.string(),
})

type PLCFunction = z.infer<typeof PLCFunctionSchema>

const PLCProgramSchema = z.object({
  language: z.enum(['il', 'st', 'ld', 'sfc', 'fbd']),
  name: z.string(),
  /** Array of variable - will be implemented */
  variables: z.array(PLCVariableSchema),
  body: z.string(),
  documentation: z.string(),
})

type PLCProgram = z.infer<typeof PLCProgramSchema>

const PLCFunctionBlockSchema = z.object({
  language: z.enum(['il', 'st', 'ld', 'sfc', 'fbd']),
  name: z.string(),
  /** Array of variable - will be implemented */
  variables: z.array(PLCVariableSchema),
  body: z.string(),
  documentation: z.string(),
})

type PLCFunctionBlock = z.infer<typeof PLCFunctionBlockSchema>

const PLCProjectDataSchema = z.object({
  dataTypes: z.array(PLCDataTypeSchema),
  pous: z.array(
    z.discriminatedUnion('type', [
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
    ]),
  ),
  configuration: z.object({
    resource: z.object({
      tasks: z.array(PLCTaskSchema),
      instances: z.array(
        z.object({
          name: z.string(), // TODO: This should be homologate. Concept: An unique identifier for the instance object.
          task: z.string(), // TODO: Implement this validation. This task must be one of the objects in the "tasks" array defined right above.
          program: z.string(), // TODO: Implement this validation. This program must be one of the user's defined pou of program type.
        }),
      ),
      globalVariables: z.array(PLCVariableSchema.omit({ class: true })),
    }),
  }),
})

type PLCProjectData = z.infer<typeof PLCProjectDataSchema>

export {
  baseTypeSchema,
  PLCDataTypeDerivationSchema,
  PLCDataTypeSchema,
  PLCDataTypeStructureElementSchema,
  PLCFunctionBlockSchema,
  PLCFunctionSchema,
  PLCGlobalVariableSchema,
  PLCProgramSchema,
  PLCProjectDataSchema,
  PLCTaskSchema,
  PLCVariableSchema,
}

export type {
  BaseType,
  PLCDataType,
  PLCDataTypeStructureElement,
  PLCFunction,
  PLCFunctionBlock,
  PLCGlobalVariable,
  PLCProgram,
  PLCProjectData,
  PLCTask,
  PLCVariable,
}
