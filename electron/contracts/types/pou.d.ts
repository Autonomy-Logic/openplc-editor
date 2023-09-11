import { z } from 'zod'

export const pouSchema = z.object({
  name: z.string().optional(),
  pouType: z.enum(['program', 'function', 'functionBlock']).optional(),
  interface: z.string().optional(),
  body: z.string().optional(),
})

export type PouSchema = z.infer<typeof pouSchema>
