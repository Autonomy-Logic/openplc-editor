import { z } from 'zod'

const createPouSchema = z.object({
  name: z.string().optional(),
  pouType: z.string().optional(),
})

export type CreatePouDTO = z.infer<typeof createPouSchema>
