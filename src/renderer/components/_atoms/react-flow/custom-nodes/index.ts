import { Block, BLOCK_CONNECTOR_1_Y, BLOCK_CONNECTOR_X, BLOCK_HEIGHT, BLOCK_WIDTH, buildBlockNode } from './block'
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

export const customNodesStyles = {
  powerRail: {
    width: POWER_RAIL_WIDTH,
    height: POWER_RAIL_HEIGHT,
    handle: {
      x: POWER_RAIL_CONNECTOR_X,
      y: POWER_RAIL_CONNECTOR_Y,
    },
  },
  block: {
    width: BLOCK_WIDTH,
    height: BLOCK_HEIGHT,
    handle: {
      x: BLOCK_CONNECTOR_X,
      y: BLOCK_CONNECTOR_1_Y,
    },
  },
}

export const nodesBuilder = {
  powerRail: buildPowerRailNode,
  block: buildBlockNode,
  mockNode: buildMockNode,
}
