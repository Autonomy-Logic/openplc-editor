import { z } from 'zod'

const PLCInstanceSchema = z.object({
    id: z.string().optional(),
    name: z.string(), // TODO: This should be homologate. Concept: An unique identifier for the instance object.
    task: z.string(), // TODO: Implement this validation. This task must be one of the objects in the "tasks" array defined right above.
    program: z.string(), // TODO: Implement this validation. This program must be one of the user's defined pou of program type.
  })

type PLCInstance = z.infer<typeof PLCInstanceSchema>

export { PLCInstance, PLCInstanceSchema }
