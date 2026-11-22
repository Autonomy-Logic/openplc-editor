import type { Node } from '@xyflow/react'

export const DEFAULT_BLOCK_WIDTH = 216
export const DEFAULT_BLOCK_HEIGHT = 128

export const DEFAULT_BLOCK_CONNECTOR_Y = 36
export const DEFAULT_BLOCK_CONNECTOR_Y_OFFSET = 40

export const DEFAULT_COIL_BLOCK_WIDTH = 28
export const DEFAULT_COIL_BLOCK_HEIGHT = 24

export const DEFAULT_COIL_CONNECTOR_X = DEFAULT_COIL_BLOCK_WIDTH
export const DEFAULT_COIL_CONNECTOR_Y = DEFAULT_COIL_BLOCK_HEIGHT / 2

export const DEFAULT_CONTACT_BLOCK_WIDTH = 24
export const DEFAULT_CONTACT_BLOCK_HEIGHT = 24

export const DEFAULT_CONTACT_CONNECTOR_X = DEFAULT_CONTACT_BLOCK_WIDTH
export const DEFAULT_CONTACT_CONNECTOR_Y = DEFAULT_CONTACT_BLOCK_HEIGHT / 2

export const DEFAULT_PARALLEL_WIDTH = 4
export const DEFAULT_PARALLEL_HEIGHT = 2

export const GAP = 0

export const DEFAULT_PARALLEL_CONNECTOR_Y = DEFAULT_PARALLEL_HEIGHT / 2

export const DEFAULT_PLACEHOLDER_WIDTH = 10
export const DEFAULT_PLACEHOLDER_HEIGHT = 10
export const DEFAULT_PLACEHOLDER_GAP = 15

export const DEFAULT_PLACEHOLDER_CONNECTOR_Y = DEFAULT_PLACEHOLDER_HEIGHT / 2

export const DEFAULT_POWER_RAIL_WIDTH = 3
export const DEFAULT_POWER_RAIL_HEIGHT = 40

export const DEFAULT_POWER_RAIL_CONNECTOR_X = DEFAULT_POWER_RAIL_WIDTH
export const DEFAULT_POWER_RAIL_CONNECTOR_Y = DEFAULT_POWER_RAIL_HEIGHT / 2

export const DEFAULT_VARIABLE_WIDTH = 80
export const DEFAULT_VARIABLE_HEIGHT = 32

export const DEFAULT_VARIABLE_CONNECTOR_X = DEFAULT_VARIABLE_WIDTH
export const DEFAULT_VARIABLE_CONNECTOR_Y = DEFAULT_VARIABLE_HEIGHT / 2

/** Rung bounds `[width, height]` used when a rung carries no usable `defaultBounds`. */
export const DEFAULT_RUNG_BOUNDS: readonly [number, number] = [300, 100]

/** Space below a block's last pin row, down to the block frame's bottom edge. */
export const LEGACY_BLOCK_BOTTOM_PADDING = 24

/** Width one character of a block or pin name adds to the block. */
export const LEGACY_BLOCK_CHAR_WIDTH = 12

/** Gap between the input and the output pin labels inside a block. */
export const LEGACY_BLOCK_LABEL_GAP = 18

/** Vertical clearance between main-line elements and the branch elements on the next block pin below. */
export const LEGACY_BRANCH_OVERLAP_PADDING = 50

/** Extra pin spacing added under a block pin whose branch holds parallels. */
export const LEGACY_BRANCH_PARALLEL_CLEARANCE = 20

/** Horizontal gap between a parallel close and a following, unrelated parallel open. */
export const LEGACY_PARALLEL_PAIR_GAP = 100

/** Size, spacing and handle offsets of one LD node type. */
export type LegacyNodeStyle = {
  width: number
  height: number
  gap: number
  verticalGap: number
  handle: {
    x: number
    y: number
    offsetY: number
  }
}

/** Today's LD node styles, keyed by xyflow node type. */
export const LEGACY_NODE_STYLES: Record<string, LegacyNodeStyle> = {
  block: {
    width: DEFAULT_BLOCK_WIDTH,
    height: DEFAULT_BLOCK_HEIGHT,
    gap: 120,
    verticalGap: 80,
    handle: {
      x: DEFAULT_BLOCK_WIDTH,
      y: DEFAULT_BLOCK_CONNECTOR_Y,
      offsetY: DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
    },
  },
  coil: {
    width: DEFAULT_COIL_BLOCK_WIDTH,
    height: DEFAULT_COIL_BLOCK_HEIGHT,
    gap: 45,
    verticalGap: 80,
    handle: {
      x: DEFAULT_COIL_CONNECTOR_X,
      y: DEFAULT_COIL_CONNECTOR_Y,
      offsetY: 0,
    },
  },
  contact: {
    width: DEFAULT_CONTACT_BLOCK_WIDTH,
    height: DEFAULT_CONTACT_BLOCK_HEIGHT,
    gap: 45,
    verticalGap: 80,
    handle: {
      x: DEFAULT_CONTACT_CONNECTOR_X,
      y: DEFAULT_CONTACT_CONNECTOR_Y,
      offsetY: 0,
    },
  },
  parallel: {
    width: DEFAULT_PARALLEL_WIDTH,
    height: DEFAULT_PARALLEL_HEIGHT,
    gap: GAP,
    verticalGap: GAP,
    handle: {
      x: 0,
      y: DEFAULT_PARALLEL_CONNECTOR_Y,
      offsetY: 0,
    },
  },
  parallelPlaceholder: {
    width: DEFAULT_PLACEHOLDER_WIDTH,
    height: DEFAULT_PLACEHOLDER_HEIGHT,
    gap: DEFAULT_PLACEHOLDER_GAP,
    verticalGap: DEFAULT_PLACEHOLDER_GAP,
    handle: {
      x: 0,
      y: DEFAULT_PLACEHOLDER_CONNECTOR_Y,
      offsetY: 0,
    },
  },
  placeholder: {
    width: DEFAULT_PLACEHOLDER_WIDTH,
    height: DEFAULT_PLACEHOLDER_HEIGHT,
    gap: DEFAULT_PLACEHOLDER_GAP,
    verticalGap: DEFAULT_PLACEHOLDER_GAP,
    handle: {
      x: 0,
      y: DEFAULT_PLACEHOLDER_CONNECTOR_Y,
      offsetY: 0,
    },
  },
  powerRail: {
    width: DEFAULT_POWER_RAIL_WIDTH,
    height: DEFAULT_POWER_RAIL_HEIGHT,
    gap: 20,
    verticalGap: 0,
    handle: {
      x: DEFAULT_POWER_RAIL_CONNECTOR_X,
      y: DEFAULT_POWER_RAIL_CONNECTOR_Y,
      offsetY: 0,
    },
  },
  variable: {
    width: DEFAULT_VARIABLE_WIDTH,
    height: DEFAULT_VARIABLE_HEIGHT,
    gap: 30,
    verticalGap: 0,
    handle: {
      x: DEFAULT_VARIABLE_CONNECTOR_X,
      y: DEFAULT_VARIABLE_CONNECTOR_Y,
      offsetY: DEFAULT_VARIABLE_CONNECTOR_Y,
    },
  },
  mockNode: {
    width: 150,
    height: 40,
    gap: 50,
    verticalGap: 50,
    handle: {
      x: 0,
      y: 20,
      offsetY: 0,
    },
  },
}

/** The style of a node, or of a node type, falling back to `mockNode` when neither is given. */
export const getDefaultNodeStyle = ({ node, nodeType }: { node?: Node; nodeType?: string }): LegacyNodeStyle => {
  return LEGACY_NODE_STYLES[node?.type ?? nodeType ?? 'mockNode']
}
