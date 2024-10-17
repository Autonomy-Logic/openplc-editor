import { z } from "zod";

const taskXMLSchema = z.object({
  '@name': z.string(),
  '@priority': z.string(),
  '@interval': z.string(),
  '@single': z.string(),
  pouInstance: z.array(z.object({
    '@name': z.string(),
    '@typeName': z.string(),
  })),
})
type TaskXml = z.infer<typeof taskXMLSchema>

export { taskXMLSchema }
export type { TaskXml }
