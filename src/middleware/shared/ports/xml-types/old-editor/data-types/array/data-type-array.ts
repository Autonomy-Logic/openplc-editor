import { z } from 'zod'

import { baseTypeTagsSchema } from '../../base-type-tags'

const dataTypeArraySchema = z.object({
  dimension: z.array(
    z.object({
      '@lower': z.string(),
      '@upper': z.string(),
    }),
  ),
  baseType: baseTypeTagsSchema,
})

export { dataTypeArraySchema }
