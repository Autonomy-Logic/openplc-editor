import { z } from 'zod'

import { PLCProjectDataSchema } from './data'

const PLCProjectJSONSchema = z.object({
  meta: z.object({
    name: z.string(),
    type: z.enum(['plc-project', 'plc-library']).default('plc-project'),
  }),
  data: PLCProjectDataSchema,
})

export { PLCProjectJSONSchema }
