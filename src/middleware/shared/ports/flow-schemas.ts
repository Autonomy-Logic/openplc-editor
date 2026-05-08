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
  // ReactFlow's emitted node updates may omit these; our builders always set
  // them but legacy projects or third-party producers may not.
  draggable: z.boolean().optional(),
  selectable: z.boolean().optional(),
  data: z.any(),
})

const edgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  // xyflow's `Edge` type allows `string | null | undefined` for handles.
  // Strict `z.string()` rejects valid edges with null handles emitted by
  // ReactFlow itself.
  sourceHandle: z.string().nullable().optional(),
  target: z.string(),
  targetHandle: z.string().nullable().optional(),
  type: z.string().optional(),
})

/**
 * Per-rung index of handle branches — mini-rungs of contacts / coils that
 * hang off a function-block input or output handle. The structural data
 * (the contact / coil nodes themselves and the edges that wire them up)
 * lives in `nodes` / `edges`; this index is a denormalized lookup that
 * makes branch operations O(1) instead of O(rung).
 *
 * `nodeIds` is the SERIAL spine of the branch only — parallel-path elements
 * (the OR alternative inside a branch's parallel) are reachable via edge
 * traversal from the OPEN/CLOSE pair on the spine.
 */
const zodHandleBranchSchema = z.object({
  blockId: z.string(),
  handleId: z.string(),
  direction: z.enum(['input', 'output']),
  nodeIds: z.array(z.string()),
})

// Default rung bounds — matches the value `startLadderRung` uses when creating
// a fresh rung. Falls back here only if a saved rung is missing the field.
const DEFAULT_RUNG_BOUNDS = [1530, 200]

const zodRungLadderStateSchema = z.object({
  id: z.string(),
  comment: z.string().default(''),
  defaultBounds: z.array(z.number()).default(DEFAULT_RUNG_BOUNDS),
  reactFlowViewport: z.array(z.number()).default(DEFAULT_RUNG_BOUNDS),
  nodes: z.array(nodeSchema).default([]),
  edges: z.array(edgeSchema).default([]),
  handleBranches: z.array(zodHandleBranchSchema).default([]),
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
  zodHandleBranchSchema,
  zodLadderFlowSchema,
  zodRungLadderStateSchema,
}
