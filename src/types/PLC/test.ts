import { z } from 'zod'

const dataTypeSchema = z.object({
  id: z.number(),
  name: z.string(),
  derivation: z.discriminatedUnion('type', [
    /** This array needs to be reviewed */
    z.object({
      type: z.literal('array'),
      baseType: z.enum([
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
        /** Can also be a local datatype - created by the user */
      ]),
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
              value: z.enum([
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
              ]),
            }),
            z.object({
              type: z.literal('array'),
              value: z.object({
                baseType: z.enum([
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
                ]),
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

const variableSchema = z.object({
  id: z.number(),
  name: z.string(),
  class: z.enum(['input', 'output', 'inOut', 'external', 'local', 'temp', 'global']),
  type: z.discriminatedUnion('definition', [
    z.object({
      definition: z.literal('base-type'),
      value: z.enum([
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
      ]),
    }),
    z.object({
      definition: z.literal('user-data-type'),
      /** In fact this will be filled by the data types created by the user */
      value: z.array(dataTypeSchema),
    }),
    z.object({
      definition: z.literal('array'),
      value: z.object({
        /** This must also include the data types created by the user */
        baseType: z.enum([
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
        ]),
        dimensions: z.string().regex(/^(\d+)\.\.(\d+)$/),
      }),
    }),
  ]),
  location: z.string(),
  // initialValue: z.string().optional(),
  documentation: z.string(),
  debug: z.boolean(),
})
const functionSchema = z.object({
  language: z.enum(['il', 'st', 'ld', 'sfc', 'fbd']).default('il'),
  name: z.string(),
  returnType: z.enum(['BOOL', 'INT', 'DINT']),
  /** Array of variable - will be implemented */
  variables: z.array(variableSchema),
  body: z.string(),
  documentation: z.string(),
})

const programSchema = z.object({
  language: z.enum(['il', 'st', 'ld', 'sfc', 'fbd']).default('il'),
  name: z.string(),
  /** Array of variable - will be implemented */
  variables: z.array(variableSchema),
  body: z.string(),
  documentation: z.string(),
})

const functionBlockSchema = z.object({
  language: z.enum(['il', 'st', 'ld', 'sfc', 'fbd']).default('il'),
  name: z.string(),
  /** Array of variable - will be implemented */
  variables: z.array(variableSchema),
  body: z.string(),
  documentation: z.string(),
})

const projectDataSchema = z.object({
  datatypes: z.array(dataTypeSchema),
  pous: z.array(
    z.discriminatedUnion('type', [
      z.object({
        type: z.literal('program'),
        data: programSchema,
      }),
      z.object({
        type: z.literal('function'),
        data: functionSchema,
      }),
      z.object({
        type: z.literal('function-block'),
        data: functionBlockSchema,
      }),
    ]),
  ),
  globalVariables: z.array(variableSchema),
})

export { functionBlockSchema, functionSchema, programSchema, projectDataSchema, variableSchema }
