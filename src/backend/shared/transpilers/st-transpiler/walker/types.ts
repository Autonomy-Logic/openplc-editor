/**
 * Minimal types describing the React Flow LD body shape — exactly
 * what the editor stores in `pous/<type>s/<name>.ld` after the
 * declaration / variables header.
 *
 * Kept narrower than the renderer's `RungLadderState` (the editor
 * type carries layout-only fields like `defaultBounds`,
 * `reactFlowViewport`, `selectedNodes`).  Only the walker-relevant
 * fields are typed here; the rest passes through as `unknown` so
 * harvested fixtures from different editor versions still load.
 */

export interface RFBody {
  rungs: RFRung[]
}

export interface RFRung {
  /** Layout-only; the walker doesn't read it.  Optional so the FBD
   *  schema shape (`{ comment, nodes, edges }`, no `id`) flows in
   *  without a typecast at the projection boundary. */
  id?: string
  comment?: string
  nodes: RFNode[]
  edges: RFEdge[]
  /** Layout-only field. Stored as `[width, height]`; the walker reads
   *  the height to globalise per-rung Y coordinates the same way the
   *  editor's `ladder-xml.ts` does when it serialises to PLCOpen. */
  reactFlowViewport?: unknown
}

export interface RFNode {
  id: string
  /** Kept as `string` (not narrowed to a literal union) so the schema
   *  boundary in `from-schema.ts` can pass the editor's `node.type:
   *  string` straight through without a typecast.  Known values the
   *  walker dispatches on: `'powerRail' | 'contact' | 'coil' | 'block'
   *  | 'variable' | 'input-variable' | 'output-variable' |
   *  'inout-variable' | 'parallel' | 'connector' | 'continuation'`.
   *  Anything else is treated as a no-op sink. */
  type: string
  position: { x: number; y: number }
  data: Record<string, unknown>
}

export interface RFEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}
