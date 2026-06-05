import { z } from 'zod'

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

const edgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  sourceHandle: z.string(),
  target: z.string(),
  targetHandle: z.string(),
  type: z.string().optional(),
})

const zodRungLadderStateSchema = z.object({
  id: z.string(),
  comment: z.string().default(''),
  defaultBounds: z.array(z.number()),
  reactFlowViewport: z.array(z.number()),
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema),
})

const zodLadderFlowSchema = z.object({
  name: z.string(),
  rungs: z.array(zodRungLadderStateSchema).default([]),
})

const zodFBDRungStateSchema = z.object({
  comment: z.string().default(''),
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema),
})

const zodFBDFlowSchema = z.object({
  name: z.string(),
  rung: zodFBDRungStateSchema,
})

export {
  edgeSchema,
  nodeSchema,
  zodFBDFlowSchema,
  zodFBDRungStateSchema,
  zodLadderFlowSchema,
  zodRungLadderStateSchema,
}
