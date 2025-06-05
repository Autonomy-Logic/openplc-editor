import { baseTypes } from '@root/shared/data'
import { z } from 'zod'

const variableXMLSchema = z.object({
  '@name': z.string(),
  '@address': z.string().optional(),
  type: z.object(baseTypes.reduce((acc, type) => ({ ...acc, [type]: z.string().optional() }), {})).optional(),
  initialValue: z
    .object({
      simpleValue: z.object({
        '@value': z.string(),
      }),
    })
    .or(z.null())
    .optional(),
  documentation: z
    .object({
      'xhtml:p': z.object({
        $: z.string(),
      }),
    })
    .optional(),
})
type VariableXML = z.infer<typeof variableXMLSchema>

export { variableXMLSchema }
export type { VariableXML }
