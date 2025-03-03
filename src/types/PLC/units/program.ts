import { PLCLanguagesShortenedForm } from '@root/shared/data'
import { z } from 'zod'

import { PLCVariableSchema } from './variable'

const PLCProgramSchema = z.object({
  language: z.enum(PLCLanguagesShortenedForm),
  name: z.string(),
  variables: z.array(PLCVariableSchema),
  body: z.string(),
  documentation: z.string(),
})

type PLCProgram = z.infer<typeof PLCProgramSchema>

export type { PLCProgram }
export { PLCProgramSchema }
