import { z } from 'zod'

import { dataTypeSchema } from './data-type'

const variableShape = z.object({
  id: z.number(),
  name: z.string(),
  class: z.enum(['input', 'output', 'inOut', 'external', 'local', 'temp']),
  type: z.lazy(() => dataTypeSchema),
  location: z.string().optional(),
  initialValue: z.string().optional(),
  debug: z.boolean().default(false),
  documentation: z.string().optional(),
})

type IVariable = z.infer<typeof variableShape>

export { IVariable,variableShape }
