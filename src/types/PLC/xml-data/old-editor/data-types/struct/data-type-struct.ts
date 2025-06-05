import { baseTypes } from '@root/shared/data'
import { z } from 'zod'

const dataTypeStructSchema = z.object({
  variable: z.array(
    z.object({
      '@name': z.string(),
      type: z.object(baseTypes.reduce((acc, type) => Object.assign(acc, { [type]: z.string().optional() }), {})).optional(),
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
