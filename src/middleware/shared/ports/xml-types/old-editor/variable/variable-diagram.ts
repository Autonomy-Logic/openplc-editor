import { z } from 'zod'

import { baseTypeTagsSchema } from '../base-type-tags'

const variableXMLSchema = z.object({
  '@name': z.string(),
  '@address': z.string().optional(),
  type: baseTypeTagsSchema.optional(),
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
