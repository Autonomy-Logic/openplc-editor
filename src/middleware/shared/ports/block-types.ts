import { z } from 'zod'

import { BaseLibraryPouSchema, BaseLibraryVariableSchema, baseTypeSchema, genericTypeSchema } from './plc-schemas'

const blockVariantVariableSchema = BaseLibraryVariableSchema.extend({
  id: z.string().optional(),
  class: z.enum(['input', 'output', 'local', 'inOut']),
  type: z.discriminatedUnion('definition', [
    z.object({
      definition: z.literal('base-type'),
      value: baseTypeSchema,
    }),
    z.object({
      definition: z.literal('generic-type'),
      value: genericTypeSchema.keyof(),
    }),
  ]),
})

const blockVariantSchema = BaseLibraryPouSchema.extend({
  variables: z.array(blockVariantVariableSchema),
  type: z.enum(['function', 'function-block', 'generic']),
})

type BlockVariant = z.infer<typeof blockVariantSchema>

export { blockVariantSchema, blockVariantVariableSchema }
export type { BlockVariant }
