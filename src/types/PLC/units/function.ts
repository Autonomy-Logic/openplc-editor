import { z } from 'zod'

import { variableSchema } from './variable'

const functionSchema = z.object({
  language: z.enum(['il', 'st', 'ld', 'sfc', 'fbd']).default('il'),
  name: z.string(),
  returnType: z.enum(['BOOL', 'INT', 'DINT']),
  /** Array of variable - will be implemented */
  variables: z.array(z.lazy(() => variableSchema)),
  body: z.string().optional(),
  documentation: z.string().optional(),
})

type IFunction = z.infer<typeof functionSchema>

export { functionSchema, IFunction }
