import { z } from 'zod'

import { variableSchema } from './variable'

const functionBlockSchema = z.object({
  language: z.enum(['il', 'st', 'ld', 'sfc', 'fbd']).default('il'),
  name: z.string(),
  /** Array of variable - will be implemented */
  variables: z.array(z.lazy(() => variableSchema)),
  body: z.string(),
  documentation: z.string(),
})

type IFunctionBlock = z.infer<typeof functionBlockSchema>

export { functionBlockSchema, IFunctionBlock }
