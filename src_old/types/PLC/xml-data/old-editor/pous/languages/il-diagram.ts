import { z } from 'zod'

const ilXMLSchema = z.object({
  'xhtml:p': z.object({
    $: z.string(),
  }),
})
type IlXML = z.infer<typeof ilXMLSchema>

export { ilXMLSchema }
export type { IlXML }
