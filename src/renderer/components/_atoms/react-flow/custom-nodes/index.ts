import {
  Block,
  BLOCK_CONNECTOR_X,
  BLOCK_CONNECTOR_Y,
  BLOCK_CONNECTOR_Y_OFFSET,
  BLOCK_HEIGHT,
  BLOCK_WIDTH,
  buildBlockNode,
} from './block'
import { buildMockNode, MockNode } from './mock-node'
import {
  buildPowerRailNode,
  POWER_RAIL_CONNECTOR_X,
  POWER_RAIL_CONNECTOR_Y,
  POWER_RAIL_HEIGHT,
  POWER_RAIL_WIDTH,
  PowerRail,
} from './power-rail'

export const customNodeTypes = {
  powerRail: PowerRail,
  block: Block,
  mockNode: MockNode,
}

type CustomNodeTypes = {
  [key: string]: {
    width: number
    height: number
    gapBetweenNodes: number
    handle: {
      x: number
      y: number
      offsetY: number
    }
  }
}
export const customNodesStyles: CustomNodeTypes = {
  powerRail: {
    width: POWER_RAIL_WIDTH,
    height: POWER_RAIL_HEIGHT,
    gapBetweenNodes: 0,
    handle: {
      x: POWER_RAIL_CONNECTOR_X,
      y: POWER_RAIL_CONNECTOR_Y,
      offsetY: 0,
    },
  },
  block: {
    width: BLOCK_WIDTH,
    height: BLOCK_HEIGHT,
    gapBetweenNodes: 80,
    handle: {
      x: BLOCK_CONNECTOR_X,
      y: BLOCK_CONNECTOR_Y,
      offsetY: BLOCK_CONNECTOR_Y_OFFSET,
    },
  },
  mockNode: {
    width: 150,
    height: 40,
    gapBetweenNodes: 50,
    handle: {
      x: 0,
      y: 20,
      offsetY: 0,
    },
  },
}

export const nodesBuilder = {
  powerRail: buildPowerRailNode,
  block: buildBlockNode,
  mockNode: buildMockNode,
}
