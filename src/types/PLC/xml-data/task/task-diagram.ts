import { z } from "zod";

const pouInstanceSchema = z.object({
  '@name': z.string(),
  '@typeName': z.string(),
})
type PouInstance = z.infer<typeof pouInstanceSchema>

const taskXMLSchema = z.object({
  '@name': z.string(),
  '@priority': z.string(),
  '@interval': z.string().nullable(),
  '@single': z.string().nullable(),
  pouInstance: z.array(z.object({
    '@name': z.string(),
    '@typeName': z.string(),
  })),
})
type TaskXML = z.infer<typeof taskXMLSchema>

export { pouInstanceSchema,taskXMLSchema }
export type { PouInstance,TaskXML }
