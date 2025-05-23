import { baseTypes, PLCLanguagesShortenedForm } from '@root/shared/data'
import { z } from 'zod'

import { PLCVariableSchema } from './variable'

const PLCFunctionSchema = z.object({
  language: z.enum(PLCLanguagesShortenedForm),
  name: z.string(),
  returnType: z.enum(baseTypes),
  variables: z.array(PLCVariableSchema),
  body: z.string(),
  documentation: z.string(),
})

type PLCFunction = z.infer<typeof PLCFunctionSchema>

export { PLCFunction, PLCFunctionSchema }
