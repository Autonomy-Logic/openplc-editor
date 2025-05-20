import { z } from 'zod'

const dataTypeEnumSchema = z.object({
  values: z.object({
    value: z.array(
      z.object({
        '@name': z.string(),
      })
    )
  })
})

export { dataTypeEnumSchema }
