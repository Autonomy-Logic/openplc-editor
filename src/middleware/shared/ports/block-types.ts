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

// A placed block carries a *signature*, not a copy of the library entry.
// `body` (the authored source, which for a native C/C++ or Python block is the
// whole file) and `language` are omitted deliberately: nothing reads either one
// back off a placed variant, and embedding the source froze a stale copy of the
// library into every project that placed the block and broke the POU parser
// (DOPE-592). Omitting them here turns a reintroduction into a compile error
// rather than a silent regression. The schema is a type source only — it is
// never `.parse()`d — so this has no runtime effect on already-saved projects.
const blockVariantSchema = BaseLibraryPouSchema.omit({ body: true, language: true }).extend({
  variables: z.array(blockVariantVariableSchema),
  type: z.enum(['function', 'function-block', 'generic']),
})

type BlockVariant = z.infer<typeof blockVariantSchema>

export { blockVariantSchema, blockVariantVariableSchema }
export type { BlockVariant }
