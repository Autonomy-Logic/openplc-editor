import { z } from 'zod'

import { interfaceXMLSchema } from './interface/interface-diagram'
import { fbdXMLSchema } from './languages/fbd-diagram'
import { ilXMLSchema } from './languages/il-diagram'
import { ladderXMLSchema } from './languages/ladder-diagram'
import { stXMLSchema } from './languages/st-diagram'

const pousSchema = z.object({
  pou: z.array(
    z.object({
      '@name': z.string(),
      '@pouType': z.enum(['program', 'function', 'functionBlock']),
      interface: interfaceXMLSchema,
      body: z.object({
        IL: ilXMLSchema.optional(),
        ST: stXMLSchema.optional(),
        LD: ladderXMLSchema.optional(),
        FBD: fbdXMLSchema.optional(),
        SFC: z.string().optional(),
      }),
      documentation: z
        .object({
          'xhtml:p': z.object({
            $: z.string(),
          }),
        })
        .optional(),
    }),
  ),
})
type PousXML = z.infer<typeof pousSchema>

export { pousSchema }
export type { PousXML }
