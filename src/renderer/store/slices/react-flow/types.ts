import { z } from 'zod'

/**
 * Types used to save at the json
 */
const nodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  height: z.number().optional(),
  width: z.number().optional(),
  measured: z
    .object({
      width: z.number(),
      height: z.number(),
    })
    .optional(),
  draggable: z.boolean(),
  selectable: z.boolean(),
  data: z.any(),
})
type NodeType = z.infer<typeof nodeSchema>

const edgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  sourceHandle: z.string(),
  target: z.string(),
  targetHandle: z.string(),
})
type EdgeType = z.infer<typeof edgeSchema>

/**
 * Zod exports
 */
export { edgeSchema, nodeSchema }

export type { EdgeType, NodeType }
