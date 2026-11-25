/**
 * Node builder functions and styles extracted from index.ts to avoid circular
 * dependencies when imported by the store layer.
 *
 * index.ts re-exports from here so that existing consumers are unaffected.
 */

import type { Node } from '@xyflow/react'

import * as buildNodes from './buildNodes'

export const checkIfElementIsNode = (element: unknown): element is Node => {
  return (element as Node)?.data !== undefined
}

export { LEGACY_NODE_STYLES as defaultCustomNodesStyles } from '@root/middleware/shared/utils/ladder-layout'

export const nodesBuilder = {
  block: buildNodes.buildBlockNode,
  coil: buildNodes.buildCoilNode,
  contact: buildNodes.buildContactNode,
  parallel: buildNodes.buildParallel,
  parallelPlaceholder: buildNodes.builderPlaceholderNode,
  placeholder: buildNodes.builderPlaceholderNode,
  powerRail: buildNodes.buildPowerRailNode,
  mockNode: buildNodes.buildMockNode,
}
