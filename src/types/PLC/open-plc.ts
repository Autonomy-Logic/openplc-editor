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

const PLCDataTypeSchema = z.object({
  id: z.number(),
  name: z.string(),
  derivation: z.discriminatedUnion('type', [
    /** This array needs to be reviewed */
    z.object({
      type: z.literal('array'),
      baseType: baseTypeSchema,
      /** This property needs to be updated to validate if the right number is higher than the left */
      dimensions: z.array(z.string().regex(/^(\d+)\.\.(\d+)$/)),
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
      elements: z.array(
        z.object({
          id: z.number(),
          name: z.string(),
          type: z.discriminatedUnion('type', [
            z.object({
              type: z.literal('base-type'),
              value: baseTypeSchema,
            }),
            z.object({
              type: z.literal('array'),
              value: z.object({
                baseType: baseTypeSchema,
                /** This property needs to be updated to validate if the right number is higher than the left */
                dimensions: z.string().regex(/^(\d+)\.\.(\d+)$/),
              }),
            }),
          ]),
        }),
      ),
    }),
  ]),
})

type PLCDataType = z.infer<typeof PLCDataTypeSchema>

const PLCVariableSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  class: z.enum(['input', 'output', 'inOut', 'external', 'local', 'temp', 'global']),
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
      /** This is a mock type just for a presentation.
       * @deprecated
       */
      // value: z.enum(['array', 'dictionary']),

      /**
       * @wip
       */
      value: z.object({
        /** This must also include the data types created by the user */
        baseType: baseTypeSchema,
        dimensions: z.array(
          z
            .string()
            .regex(/^(\d+)\.\.(\d+)$/)
            .refine((value) => {
              const [left, right] = value.split('..').map(Number)
              if (left <= 0 || right <= 0) {
                return false
              }
              return left < right
            }),
        ),
        format: z.string(),
      }),
    }),
  ]),
  location: z.string(),
  // initialValue: z.string().optional(),
  documentation: z.string(),
  debug: z.boolean(),
})

type PLCVariable = z.infer<typeof PLCVariableSchema>

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
  globalVariables: z.array(PLCVariableSchema),
})

type PLCProjectData = z.infer<typeof PLCProjectDataSchema>

export {
  baseTypeSchema,
  PLCDataTypeSchema,
  PLCFunctionBlockSchema,
  PLCFunctionSchema,
  PLCProgramSchema,
  PLCProjectDataSchema,
  PLCVariableSchema,
}

export type { BaseType, PLCDataType, PLCFunction, PLCFunctionBlock, PLCProgram, PLCProjectData, PLCVariable }
