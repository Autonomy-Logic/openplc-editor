/** A label to draw: x and y in rung canvas coordinates, y the text baseline. */
export interface LabelBox {
  text: string
  x: number
  y: number
  sizePx: number
  weight: 400 | 600
  anchor: 'start' | 'middle' | 'end'
  role: 'name' | 'location' | 'blockType' | 'instance' | 'pinFormal' | 'pinVariable'
}

/** A node's stored geometry; for a block, the box only (no instance line, no side label columns). Handles are relative to the node. */
export interface NodeGeometry {
  position: { x: number; y: number }
  width: number
  height: number
  handles: readonly { id: string; x: number; y: number }[]
}

/** A top-level element of the main series; a parallel group is one. */
export interface LayoutSegment {
  nodeIds: readonly string[]
  x: number
  width: number
}

/** One branch of a parallel group, canonical coordinates. */
export interface ParallelBranchLayout {
  /** The branch's elements left to right, an inner group's nodes included. */
  nodeIds: readonly string[]
  /** The branch's wire y. */
  y: number
  /** Left edge of the first element column: openX + parPad, or in an 'end' group closeX - parPad - content width. */
  startX: number
  /** Where the branch's wire leaves its last element: its output handle x, or an inner group's closeX. */
  endX: number
}

/** A parallel group: one open/close pair, or a stack of pairs that today's editor builds for a third or later branch. */
export interface ParallelGroupLayout {
  /** Opening parallel nodes, top to bottom. */
  openNodeIds: readonly string[]
  /** Closing parallel nodes, top to bottom. */
  closeNodeIds: readonly string[]
  /** X of the opening junction line. */
  openX: number
  /** X of the closing junction line. */
  closeX: number
  /** Wire y of the top branch. */
  yTop: number
  /** Wire y of the bottom branch. */
  yBottom: number
  /** 0 when not inside another group's branch; +1 per enclosing group. */
  depth: number
  /** 'end' only for a trailing all-coil group of trailingOutputIds. */
  alignment: 'start' | 'end'
  /** Top to bottom. */
  branches: readonly ParallelBranchLayout[]
}

/**
 * The straight wire that takes up a branch's spare width (derived, never stored): after its last element, or, in a
 * trailing coil group, before its first element.
 */
export interface BranchFiller {
  /** The closing parallel node the branch's wire ends on. */
  closeNodeId: string
  /** Index in its group's branches. */
  branchIndex: number
  /** 'before' only in an 'end' group. */
  side: 'after' | 'before'
  /** The branch's wire y. */
  y: number
  /** 'after': the branch's endX; 'before': the group's openX. */
  x1: number
  /** 'after': the group's closeX; 'before': the input handle x of the branch's first element. */
  x2: number
}

/** The layout engine's output for one rung: stored geometry, display labels and the derived structure later phases draw. */
export interface RungLayout {
  rungId: string
  /** Canonical geometry, the part that is stored. */
  nodes: ReadonlyMap<string, NodeGeometry>
  /** Display-only labels per node id; a pin variable's labels sit on its variable node. */
  labels: ReadonlyMap<string, readonly LabelBox[]>
  /** Canonical natural size, stored as defaultBounds and reactFlowViewport. */
  size: { width: number; height: number }
  /** Y of the rung's main wire. */
  mainWireY: number
  /** Node id of the right power rail; undefined when the rung has none. */
  rightRailId: string | undefined
  /** Trailing coils, or a trailing all-coil parallel group with its parallel nodes. */
  trailingOutputIds: readonly string[]
  /** Left to right, trailing outputs as the last segment; may hold parallel and variable nodes. */
  segments: readonly LayoutSegment[]
  /** Every group (main series, nested, pin networks), outer before inner, then top to bottom. */
  parallels: readonly ParallelGroupLayout[]
  /** One per branch of every group. */
  branchFillers: readonly BranchFiller[]
}
