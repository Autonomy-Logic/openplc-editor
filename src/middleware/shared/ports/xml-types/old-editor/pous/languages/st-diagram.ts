import { z } from 'zod'

const stXMLSchema = z.object({
  'xhtml:p': z.object({
    $: z.string(),
  }),
})
type StXML = z.infer<typeof stXMLSchema>

export { stXMLSchema }
export type { StXML }
