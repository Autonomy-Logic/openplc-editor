import { z } from 'zod'

const ilXMLSchema = z.object({
  'xhtml': z.object({
    '@xmlns': z.string().default('http://www.w3.org/1999/xhtml'),
    $: z.string(),
  }),
})
type IlXML = z.infer<typeof ilXMLSchema>

export { ilXMLSchema }
export type { IlXML }
