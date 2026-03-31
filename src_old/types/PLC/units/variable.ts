import { z } from 'zod'

import { PLCBaseTypesSchema } from './base-types'

const PLCVariableSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  class: z.enum(['input', 'output', 'inOut', 'external', 'local', 'temp', 'global']).optional(),
  type: z.discriminatedUnion('definition', [
    z.object({
      definition: z.literal('base-type'),
      value: PLCBaseTypesSchema,
    }),
    z.object({
      definition: z.literal('user-data-type'),
      value: z.string(),
    }),
    z.object({
      definition: z.literal('array'),
      value: z.string(),
      data: z.object({
        baseType: z.discriminatedUnion('definition', [
          z.object({
            definition: z.literal('base-type'),
            value: PLCBaseTypesSchema,
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

const PLCGlobalVariableSchema = PLCVariableSchema.extend({
  class: z.literal('global'),
})

type PLCGlobalVariable = z.infer<typeof PLCGlobalVariableSchema>
type PLCVariableType = z.infer<typeof PLCVariableSchema>['type']

export { PLCGlobalVariable, PLCGlobalVariableSchema, PLCVariable, PLCVariableSchema, PLCVariableType }
