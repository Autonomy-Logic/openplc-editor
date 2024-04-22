import { z } from 'zod'

const functionBlockSchema = z.object({
  language: z.enum(['IL', 'ST', 'LD', 'SFC', 'FBD']).default('IL'),
  name: z.string(),
  /** Array of variable - will be implemented */
  variables: z.array(z.string()).optional(),
  body: z.string().optional(),
  documentation: z.string().optional(),
})

type IFunctionBlock = z.infer<typeof functionBlockSchema>

export { functionBlockSchema, IFunctionBlock }
