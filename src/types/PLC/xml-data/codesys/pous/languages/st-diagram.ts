import { z } from 'zod'

const stXMLSchema = z.object({
  xhtml: z.object({
    '@xmlns': z.string().default('http://www.w3.org/1999/xhtml'),
    $: z.string(),
  }),
})
type StXML = z.infer<typeof stXMLSchema>

export { stXMLSchema }
export type { StXML }
