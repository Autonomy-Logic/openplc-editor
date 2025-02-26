import { z } from 'zod'

import { zodFlowSchema } from '../../renderer/store/slices/flow/types'

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

const PLCArrayDatatypeSchema = z.object({
  name: z.string(),
  derivation: z.literal('array'),
  baseType: z.discriminatedUnion('definition', [
    z.object({
      definition: z.literal('base-type'),
      value: baseTypeSchema,
    }),
    z.object({
      definition: z.literal('user-data-type'),
      value: z.string(),
    }),
  ]),
  initialValue: z.string().optional(),
  dimensions: z.array(z.object({ dimension: z.string() })),
})

const PLCEnumeratedDatatypeSchema = z.object({
  name: z.string(),
  derivation: z.literal('enumerated'),
  initialValue: z.string().optional(),
  values: z.array(z.object({ description: z.string() })),
})

const PLCStructureVariableSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  type: z.discriminatedUnion('definition', [
    z.object({
      definition: z.literal('base-type'),
      value: baseTypeSchema,
    }),
    z.object({
      definition: z.literal('user-data-type'),
      value: z.string(),
    }),
    z.object({
      definition: z.literal('array'),
      value: z.string(),
      data: z.object({
        /** This must also include the data types created by the user */
        baseType: z.discriminatedUnion('definition', [
          z.object({
            definition: z.literal('base-type'),
            value: baseTypeSchema,
          }),
          z.object({
            definition: z.literal('user-data-type'),
            value: z.string(),
          }),
        ]),
        dimensions: z.array(z.object({ dimension: z.string() })),
      }),
    }),
    z.object({
      /**
       * This should be ommited at variable table type options
       */
      definition: z.literal('derived'),
      value: z.string(),
    }),
  ]),
  initialValue: z
    .object({
      simpleValue: z.object({
        value: z.string(),
      }),
    })
    .optional(),
})
const PLCStructureDatatypeSchema = z.object({
  name: z.string(),
  derivation: z.literal('structure'),
  variable: z.array(PLCStructureVariableSchema),
})

type PLCEnumeratedDatatype = z.infer<typeof PLCEnumeratedDatatypeSchema>
type PLCArrayDatatype = z.infer<typeof PLCArrayDatatypeSchema>
type PLCStructureDatatype = z.infer<typeof PLCStructureDatatypeSchema>
type PLCStructureVariable = z.infer<typeof PLCStructureVariableSchema>

const PLCDataTypeSchema = z.discriminatedUnion('derivation', [
  PLCStructureDatatypeSchema,
  PLCEnumeratedDatatypeSchema,
  PLCArrayDatatypeSchema,
])

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
      value: z.string(),
    }),
    z.object({
      definition: z.literal('array'),
      value: z.string(),
      data: z.object({
        /** This must also include the data types created by the user */
        baseType: z.discriminatedUnion('definition', [
          z.object({
            definition: z.literal('base-type'),
            value: baseTypeSchema,
          }),
          z.object({
            definition: z.literal('user-data-type'),
            value: z.string(),
          }),
        ]),
        dimensions: z.array(z.object({ dimension: z.string() })),
      }),
    }),
    z.object({
      /**
       * This should be omitted at variable table type options
       */
      definition: z.literal('derived'),
      value: z.string(),
    }),
  ]),
  location: z.string(),
  initialValue: z.string().or(z.null()).optional(),
  documentation: z.string(),
  debug: z.boolean(),
})

type PLCVariable = z.infer<typeof PLCVariableSchema>
const PLCGlobalVariableSchema = PLCVariableSchema
type PLCGlobalVariable = z.infer<typeof PLCGlobalVariableSchema>

const PLCTaskSchema = z.object({
  id: z.string().optional(),
  name: z.string(), // TODO: This should be homologate. Concept: An unique identifier for the task object.
  triggering: z.enum(['Cyclic', 'Interrupt']),
  interval: z.string(), // TODO: Must have a regex validation for this. Probably a new modal must be created to handle this.
  priority: z.number(), // TODO: implement this validation. This must be a positive integer from 0 to 100
})

type PLCTask = z.infer<typeof PLCTaskSchema>

const bodySchema = z.discriminatedUnion('language', [
  z.object({
    language: z.literal('il'),
    value: z.string(),
  }),
  z.object({
    language: z.literal('st'),
    value: z.string(),
  }),
  z.object({
    language: z.literal('ld'),
    value: zodFlowSchema,
  }),
  z.object({
    language: z.literal('sfc'),
    value: z.string(),
  }),
  z.object({
    language: z.literal('fbd'),
    value: z.string(),
  }),
])
//
const PLCFunctionSchema = z.object({
  language: z.enum(['il', 'st', 'ld', 'sfc', 'fbd']),
  name: z.string(),
  returnType: z.union([baseTypeSchema, z.string()]),
  /** Array of variable - will be implemented */
  variables: z.array(PLCVariableSchema),
  body: bodySchema,
  documentation: z.string(),
})

type PLCFunction = z.infer<typeof PLCFunctionSchema>

const PLCProgramSchema = z.object({
  language: z.enum(['il', 'st', 'ld', 'sfc', 'fbd']),
  name: z.string(),
  /** Array of variable - will be implemented */
  variables: z.array(PLCVariableSchema),
  body: bodySchema,
  documentation: z.string(),
})

type PLCProgram = z.infer<typeof PLCProgramSchema>

const PLCInstanceSchema = z.object({
  id: z.string().optional(),
  name: z.string(), // TODO: This should be homologate. Concept: An unique identifier for the instance object.
  task: z.string(), // TODO: Implement this validation. This task must be one of the objects in the "tasks" array defined right above.
  program: z.string(), // TODO: Implement this validation. This program must be one of the user's defined pou of program type.
})

type PLCInstance = z.infer<typeof PLCInstanceSchema>

const PLCFunctionBlockSchema = z.object({
  language: z.enum(['il', 'st', 'ld', 'sfc', 'fbd']),
  name: z.string(),
  /** Array of variable - will be implemented */
  variables: z.array(PLCVariableSchema),
  body: bodySchema,
  documentation: z.string(),
})

type PLCFunctionBlock = z.infer<typeof PLCFunctionBlockSchema>

const PLCPouSchema = z.discriminatedUnion('type', [
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
type PLCPou = z.infer<typeof PLCPouSchema>

const PLCConfigurationSchema = z.object({
  resource: z.object({
    tasks: z.array(PLCTaskSchema),
    instances: z.array(PLCInstanceSchema),
    globalVariables: z.array(PLCVariableSchema.omit({ class: true })),
  }),
})
type PLCConfiguration = z.infer<typeof PLCConfigurationSchema>

const PLCProjectDataSchema = z.object({
  dataTypes: z.array(PLCDataTypeSchema),
  pous: z.array(PLCPouSchema),
  configuration: PLCConfigurationSchema,
})

type PLCProjectData = z.infer<typeof PLCProjectDataSchema>

const PLCProjectMetaSchema = z.object({
  name: z.string(),
  type: z.enum(['plc-project', 'plc-library']),
})
type PLCProjectMeta = z.infer<typeof PLCProjectMetaSchema>

const PLCProjectSchema = z.object({
  meta: PLCProjectMetaSchema,
  data: PLCProjectDataSchema,
})

type PLCProject = z.infer<typeof PLCProjectSchema>

export {
  baseTypeSchema,
  bodySchema,
  PLCArrayDatatypeSchema,
  PLCConfigurationSchema,
  PLCDataTypeSchema,
  PLCEnumeratedDatatypeSchema,
  PLCFunctionBlockSchema,
  PLCFunctionSchema,
  PLCGlobalVariableSchema,
  PLCInstanceSchema,
  PLCPouSchema,
  PLCProgramSchema,
  PLCProjectDataSchema,
  PLCProjectMetaSchema,
  PLCProjectSchema,
  PLCStructureDatatypeSchema,
  PLCStructureVariableSchema,
  PLCTaskSchema,
  PLCVariableSchema,
}

export type {
  BaseType,
  PLCArrayDatatype,
  PLCConfiguration,
  PLCDataType,
  PLCEnumeratedDatatype,
  PLCFunction,
  PLCFunctionBlock,
  PLCGlobalVariable,
  PLCInstance,
  PLCPou,
  PLCProgram,
  PLCProject,
  PLCProjectData,
  PLCProjectMeta,
  PLCStructureDatatype,
  PLCStructureVariable,
  PLCTask,
  PLCVariable,
}
