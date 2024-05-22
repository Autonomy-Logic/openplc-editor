import { z } from 'zod'

import { dataTypeSchema } from './data-type'

const variableSchema = z.object({
  id: z.number(),
  name: z.string(),
  class: z.enum(['input', 'output', 'inOut', 'external', 'local', 'temp']).default('input'),
  type: z
    .discriminatedUnion('scope', [
      z.object({
        scope: z.literal('base-type'),
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
        scope: z.literal('user-data-type'),
        /** In fact this will be filled by the data types created by the user */
        value: z.lazy(() => dataTypeSchema),
      }),
      z.object({
        scope: z.literal('array'),
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
    ])
    .default({ scope: 'base-type', value: 'string' }),
  location: z.string().default(''),
  // initialValue: z.string().optional(),
  documentation: z.string().default(''),
  debug: z.boolean().default(false),
})

type IVariable = z.infer<typeof variableSchema>

export { IVariable, variableSchema }
