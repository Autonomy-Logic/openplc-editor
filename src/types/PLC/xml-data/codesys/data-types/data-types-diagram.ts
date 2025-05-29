import { z } from 'zod'

import { dataTypeArraySchema } from './array/data-type-array'
import { dataTypeEnumSchema } from './enum/data-type-enum'
import { dataTypeStructSchema } from './struct/data-type-struct'

const dataTypeSchema = z.object({
  dataType: z.array(
    z.object({
      '@name': z.string(),
      baseType: z.object({
        array: dataTypeArraySchema.optional(),
        enum: dataTypeEnumSchema.optional(),
        struct: dataTypeStructSchema.optional(),
      }),
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

export { dataTypeSchema }
