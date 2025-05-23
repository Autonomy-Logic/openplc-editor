import { PLCLanguagesShortenedForm } from '@root/shared/data'
import { z } from 'zod'

import { PLCVariableSchema } from './variable'

const PLCFunctionBlockSchema = z.object({
  language: z.enum(PLCLanguagesShortenedForm),
  name: z.string(),
  variables: z.array(PLCVariableSchema),
  body: z.string(),
  documentation: z.string(),
})

type PLCFunctionBlock = z.infer<typeof PLCFunctionBlockSchema>

export { PLCFunctionBlock, PLCFunctionBlockSchema }
