import { z } from 'zod'

export const toolbarPositionSchema = z.object({
  x: z.number(),
  y: z.number(),
})

export type ToolbarPositionProps = z.infer<typeof toolbarPositionSchema>
