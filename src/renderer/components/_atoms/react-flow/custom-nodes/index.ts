import { Node } from '@xyflow/react'

import * as blockNode from './block'
import * as coilNode from './coil'
import * as contactNode from './contact'
import * as mockNode from './mock-node'
import * as parallelNode from './parallel'
import * as placeholderNode from './placeholder'
import * as powerRailNode from './power-rail'
import * as variableNode from './variable'

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

type CustomNodeTypes = {
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
export const defaultCustomNodesStyles: CustomNodeTypes = {
  block: {
    width: blockNode.DEFAULT_BLOCK_WIDTH,
    height: blockNode.DEFAULT_BLOCK_HEIGHT,
    gap: 100,
    verticalGap: 80,
    handle: {
      x: blockNode.DEFAULT_BLOCK_CONNECTOR_X,
      y: blockNode.DEFAULT_BLOCK_CONNECTOR_Y,
      offsetY: blockNode.DEFAULT_BLOCK_CONNECTOR_Y_OFFSET,
    },
  },
  coil: {
    width: coilNode.DEFAULT_COIL_BLOCK_WIDTH,
    height: coilNode.DEFAULT_COIL_BLOCK_HEIGHT,
    gap: 55,
    verticalGap: 80,
    handle: {
      x: coilNode.DEFAULT_COIL_CONNECTOR_X,
      y: coilNode.DEFAULT_COIL_CONNECTOR_Y,
      offsetY: 0,
    },
  },
  contact: {
    width: contactNode.DEFAULT_CONTACT_BLOCK_WIDTH,
    height: contactNode.DEFAULT_CONTACT_BLOCK_HEIGHT,
    gap: 55,
    verticalGap: 80,
    handle: {
      x: contactNode.DEFAULT_CONTACT_CONNECTOR_X,
      y: contactNode.DEFAULT_CONTACT_CONNECTOR_Y,
      offsetY: 0,
    },
  },
  parallel: {
    width: parallelNode.DEFAULT_PARALLEL_WIDTH,
    height: parallelNode.DEFAULT_PARALLEL_HEIGHT,
    gap: parallelNode.GAP,
    verticalGap: parallelNode.GAP,
    handle: {
      x: 0,
      y: parallelNode.DEFAULT_PARALLEL_CONNECTOR_Y,
      offsetY: 0,
    },
  },
  parallelPlaceholder: {
    width: placeholderNode.DEFAULT_PLACEHOLDER_WIDTH,
    height: placeholderNode.DEFAULT_PLACEHOLDER_HEIGHT,
    gap: placeholderNode.DEFAULT_PLACEHOLDER_GAP,
    verticalGap: placeholderNode.DEFAULT_PLACEHOLDER_GAP,
    handle: {
      x: 0,
      y: placeholderNode.DEFAULT_PLACEHOLDER_CONNECTOR_Y,
      offsetY: 0,
    },
  },
  placeholder: {
    width: placeholderNode.DEFAULT_PLACEHOLDER_WIDTH,
    height: placeholderNode.DEFAULT_PLACEHOLDER_HEIGHT,
    gap: placeholderNode.DEFAULT_PLACEHOLDER_GAP,
    verticalGap: placeholderNode.DEFAULT_PLACEHOLDER_GAP,
    handle: {
      x: 0,
      y: placeholderNode.DEFAULT_PLACEHOLDER_CONNECTOR_Y,
      offsetY: 0,
    },
  },
  powerRail: {
    width: powerRailNode.DEFAULT_POWER_RAIL_WIDTH,
    height: powerRailNode.DEFAULT_POWER_RAIL_HEIGHT,
    gap: 20,
    verticalGap: 0,
    handle: {
      x: powerRailNode.DEFAULT_POWER_RAIL_CONNECTOR_X,
      y: powerRailNode.DEFAULT_POWER_RAIL_CONNECTOR_Y,
      offsetY: 0,
    },
  },
  variable: {
    width: variableNode.DEFAULT_VARIABLE_WIDTH,
    height: variableNode.DEFAULT_VARIABLE_HEIGHT,
    gap: 30,
    verticalGap: 0,
    handle: {
      x: variableNode.DEFAULT_VARIABLE_CONNECTOR_X,
      y: variableNode.DEFAULT_VARIABLE_CONNECTOR_Y,
      offsetY: variableNode.DEFAULT_VARIABLE_CONNECTOR_Y,
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
  block: blockNode.buildBlockNode,
  coil: coilNode.buildCoilNode,
  contact: contactNode.buildContactNode,
  parallel: parallelNode.buildParallel,
  parallelPlaceholder: placeholderNode.builderPlaceholderNode,
  placeholder: placeholderNode.builderPlaceholderNode,
  powerRail: powerRailNode.buildPowerRailNode,
  variable: variableNode.buildVariableNode,
  mockNode: mockNode.buildMockNode,
}

export const checkIfElementIsNode = (element: unknown): element is Node => {
  return (element as Node)?.data !== undefined
}
