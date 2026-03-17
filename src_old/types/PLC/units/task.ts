import { z } from 'zod'

const PLCTaskSchema = z.object({
  id: z.string().optional(),
  name: z.string(), // TODO: This should be homologate. Concept: An unique identifier for the task object.
  triggering: z.enum(['CYCLIC', 'INTERRUPT']),
  interval: z.string(), // TODO: Must have a regex validation for this. Probably a new modal must be created to handle this.
  priority: z.number(), // TODO: implement this validation. This must be a positive integer from 0 to 100
})

type PLCTask = z.infer<typeof PLCTaskSchema>

export { PLCTask, PLCTaskSchema }
