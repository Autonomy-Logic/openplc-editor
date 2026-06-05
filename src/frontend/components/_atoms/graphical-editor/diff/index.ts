export { DIFF_BG, DIFF_RING, EDGE_DIFF_STROKE, STRUCTURAL_NODE_TYPES, VAR_DIFF_COLORS } from './constants'
export { DiffWrapper, renderFBDHandles, renderHandles } from './diff-wrapper'
export { ReadOnlyComment, ReadOnlyConnector, ReadOnlyFBDBlock, ReadOnlyFBDVariable } from './fbd-nodes'
export {
  ReadOnlyBlock,
  ReadOnlyCoil,
  ReadOnlyContact,
  ReadOnlyMockNode,
  ReadOnlyParallel,
  ReadOnlyPlaceholder,
  ReadOnlyPowerRail,
  ReadOnlyVariable,
} from './ladder-nodes'

import { ReadOnlyComment, ReadOnlyConnector, ReadOnlyFBDBlock, ReadOnlyFBDVariable } from './fbd-nodes'
import {
  ReadOnlyBlock,
  ReadOnlyCoil,
  ReadOnlyContact,
  ReadOnlyMockNode,
  ReadOnlyParallel,
  ReadOnlyPlaceholder,
  ReadOnlyPowerRail,
  ReadOnlyVariable,
} from './ladder-nodes'

export const ladderDiffNodeTypes = {
  powerRail: ReadOnlyPowerRail,
  contact: ReadOnlyContact,
  coil: ReadOnlyCoil,
  block: ReadOnlyBlock,
  variable: ReadOnlyVariable,
  parallel: ReadOnlyParallel,
  placeholder: ReadOnlyPlaceholder,
  parallelPlaceholder: ReadOnlyPlaceholder,
  mockNode: ReadOnlyMockNode,
}

export const fbdDiffNodeTypes = {
  block: ReadOnlyFBDBlock,
  'input-variable': ReadOnlyFBDVariable,
  'output-variable': ReadOnlyFBDVariable,
  'inout-variable': ReadOnlyFBDVariable,
  connector: ReadOnlyConnector,
  continuation: ReadOnlyConnector,
  comment: ReadOnlyComment,
}
