/**
 * Node builder functions and styles extracted from index.ts to avoid circular
 * dependencies when imported by the store layer.
 *
 * index.ts re-exports from here so that existing consumers are unaffected.
 */

import type { Node } from '@xyflow/react'

import * as buildNodes from './buildNodes'
import * as constants from './utils/constants'

export const checkIfElementIsNode = (element: unknown): element is Node => {
  return (element as Node)?.data !== undefined
}

type CustomLadderNodeTypes = {
  [key: string]: {
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
}

export const defaultCustomNodesStyles: CustomLadderNodeTypes = {
  block: {
    width: constants.DEFAULT_BLOCK_WIDTH,
    height: constants.DEFAULT_BLOCK_HEIGHT,
    gap: 120,
    verticalGap: 80,
    handle: {
      x: constants.DEFAULT_BLOCK_WIDTH,
      y: constants.DEFAULT_BLOCK_CONNECTOR_Y,
      offsetY: constants.DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
    },
  },
  coil: {
    width: constants.DEFAULT_COIL_BLOCK_WIDTH,
    height: constants.DEFAULT_COIL_BLOCK_HEIGHT,
    gap: 45,
    verticalGap: 80,
    handle: {
      x: constants.DEFAULT_COIL_CONNECTOR_X,
      y: constants.DEFAULT_COIL_CONNECTOR_Y,
      offsetY: 0,
    },
  },
  contact: {
    width: constants.DEFAULT_CONTACT_BLOCK_WIDTH,
    height: constants.DEFAULT_CONTACT_BLOCK_HEIGHT,
    gap: 45,
    verticalGap: 80,
    handle: {
      x: constants.DEFAULT_CONTACT_CONNECTOR_X,
      y: constants.DEFAULT_CONTACT_CONNECTOR_Y,
      offsetY: 0,
    },
  },
  parallel: {
    width: constants.DEFAULT_PARALLEL_WIDTH,
    height: constants.DEFAULT_PARALLEL_HEIGHT,
    gap: constants.GAP,
    verticalGap: constants.GAP,
    handle: {
      x: 0,
      y: constants.DEFAULT_PARALLEL_CONNECTOR_Y,
      offsetY: 0,
    },
  },
  parallelPlaceholder: {
    width: constants.DEFAULT_PLACEHOLDER_WIDTH,
    height: constants.DEFAULT_PLACEHOLDER_HEIGHT,
    gap: constants.DEFAULT_PLACEHOLDER_GAP,
    verticalGap: constants.DEFAULT_PLACEHOLDER_GAP,
    handle: {
      x: 0,
      y: constants.DEFAULT_PLACEHOLDER_CONNECTOR_Y,
      offsetY: 0,
    },
  },
  placeholder: {
    width: constants.DEFAULT_PLACEHOLDER_WIDTH,
    height: constants.DEFAULT_PLACEHOLDER_HEIGHT,
    gap: constants.DEFAULT_PLACEHOLDER_GAP,
    verticalGap: constants.DEFAULT_PLACEHOLDER_GAP,
    handle: {
      x: 0,
      y: constants.DEFAULT_PLACEHOLDER_CONNECTOR_Y,
      offsetY: 0,
    },
  },
  powerRail: {
    width: constants.DEFAULT_POWER_RAIL_WIDTH,
    height: constants.DEFAULT_POWER_RAIL_HEIGHT,
    gap: 20,
    verticalGap: 0,
    handle: {
      x: constants.DEFAULT_POWER_RAIL_CONNECTOR_X,
      y: constants.DEFAULT_POWER_RAIL_CONNECTOR_Y,
      offsetY: 0,
    },
  },
  variable: {
    width: constants.DEFAULT_VARIABLE_WIDTH,
    height: constants.DEFAULT_VARIABLE_HEIGHT,
    gap: 30,
    verticalGap: 0,
    handle: {
      x: constants.DEFAULT_VARIABLE_CONNECTOR_X,
      y: constants.DEFAULT_VARIABLE_CONNECTOR_Y,
      offsetY: constants.DEFAULT_VARIABLE_CONNECTOR_Y,
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

export const nodesBuilder = {
  block: buildNodes.buildBlockNode,
  coil: buildNodes.buildCoilNode,
  contact: buildNodes.buildContactNode,
  parallel: buildNodes.buildParallel,
  parallelPlaceholder: buildNodes.builderPlaceholderNode,
  placeholder: buildNodes.builderPlaceholderNode,
  powerRail: buildNodes.buildPowerRailNode,
  variable: buildNodes.buildVariableNode,
  mockNode: buildNodes.buildMockNode,
}
