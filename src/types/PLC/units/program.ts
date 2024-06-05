import { z } from 'zod'

import { variableSchema } from './variable'

const programSchema = z.object({
  language: z.enum(['il', 'st', 'ld', 'sfc', 'fbd']).default('il'),
  name: z.string(),
  /** Array of variable - will be implemented */
  variables: z.array(z.lazy(() => variableSchema)),
  body: z.string(),
  documentation: z.string(),
})

type IProgram = z.infer<typeof programSchema>

export { IProgram, programSchema }
