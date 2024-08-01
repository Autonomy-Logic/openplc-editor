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
}

export const nodesBuilder = {
  powerRail: buildPowerRailNode,
  mockNode: buildMockNode,
}
