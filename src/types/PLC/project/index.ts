import { z } from 'zod'

const PLCProjectJSONSchema = z.object({
  meta: z.object({
    name: z.string(),
    type: z.enum(['plc-project', 'plc-library']).default('plc-project'),
  }),
  data: z.object({
    'data-types': z.array(z.string()),
    pous: z.array(z.string()),
    configurations: z.object({
      resource: z.object({
        tasks: z.array(z.string()),
        instances: z.array(z.string()),
        globalVariables: z.array(z.string()),
      }),
    }),
  }),
})

export { PLCProjectJSONSchema }
