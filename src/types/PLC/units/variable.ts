import { z } from 'zod'

import { PLCBasetypesSchema } from './base-types'

const PLCVariableSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  class: z.enum(['input', 'output', 'inOut', 'external', 'local', 'temp']),
  type: z.discriminatedUnion('definition', [
    z.object({
      definition: z.literal('base-type'),
      value: PLCBasetypesSchema,
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
        'base-type': PLCBasetypesSchema,
        dimensions: z.array(z.string()),
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
  location: z.string(),
  initialValue: z.string().optional(),
  documentation: z.string(),
  debug: z.boolean(),
})

type PLCVariable = z.infer<typeof PLCVariableSchema>

const PLCGlobalVariableSchema = PLCVariableSchema.extend({
  class: z.literal('global'),
})

type PLCGlobalVariable = z.infer<typeof PLCGlobalVariableSchema>

export { PLCGlobalVariable, PLCGlobalVariableSchema, PLCVariable, PLCVariableSchema }
