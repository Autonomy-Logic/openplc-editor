import { Node } from '@xyflow/react'

import * as blockNode from './block'
import * as coilNode from './coil'
import * as contactNode from './contact'
import * as mockNode from './mock-node'
import * as parallelNode from './parallel'
import * as placeholderNode from './placeholder'
import * as powerRailNode from './power-rail'
import * as variableNode from './variable'

// Re-export from node-builders (safe for store-layer imports, no circular deps)
export { defaultCustomNodesStyles, nodesBuilder } from './node-builders'

export const DEFAULT_NODES_GAP = 50

export const customNodeTypes = {
  block: blockNode.Block,
  coil: coilNode.Coil,
  contact: contactNode.Contact,
  parallel: parallelNode.Parallel,
  parallelPlaceholder: placeholderNode.Placeholder,
  placeholder: placeholderNode.Placeholder,
  powerRail: powerRailNode.PowerRail,
  variable: variableNode.VariableElement,
  mockNode: mockNode.MockNode,
}

export const checkIfElementIsNode = (element: unknown): element is Node => {
  return (element as Node)?.data !== undefined
}
