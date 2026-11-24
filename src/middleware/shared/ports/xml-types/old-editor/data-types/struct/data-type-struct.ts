import { z } from 'zod'

import { baseTypeTagsSchema } from '../../base-type-tags'

const dataTypeStructSchema = z.object({
  variable: z.array(
    z.object({
      '@name': z.string(),
      type: baseTypeTagsSchema.optional(),
      initialValue: z
        .object({
          simpleValue: z.object({
            '@value': z.string(),
          }),
        })
        .optional(),
    }),
  ),
})

export { dataTypeStructSchema }
