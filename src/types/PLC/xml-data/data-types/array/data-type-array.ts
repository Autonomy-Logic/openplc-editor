import { baseTypes } from '@root/shared/data'
import { z } from 'zod'

const dataTypeArraySchema = z.object({
  dimension: z.array(
    z.object({
      '@lower': z.string(),
      '@upper': z.string(),
    }),
  ),
  baseType: z.object(baseTypes.reduce((acc, type) => ({ ...acc, [type]: z.string().optional() }), {})),
})

export { dataTypeArraySchema }
