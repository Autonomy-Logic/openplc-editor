import * as blockNode from './block'
import * as contactNode from './contact'
import * as mockNode from './mock-node'
import * as powerRailNode from './power-rail'

export const customNodeTypes = {
  block: blockNode.Block,
  contact: contactNode.Contact,
  powerRail: powerRailNode.PowerRail,
  mockNode: mockNode.MockNode,
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
  block: {
    width: blockNode.BLOCK_WIDTH,
    height: blockNode.BLOCK_HEIGHT,
    gapBetweenNodes: 100,
    handle: {
      x: blockNode.BLOCK_CONNECTOR_X,
      y: blockNode.BLOCK_CONNECTOR_Y,
      offsetY: blockNode.BLOCK_CONNECTOR_Y_OFFSET,
    },
  },
  contact: {
    width: contactNode.CONTACT_BLOCK_WIDTH,
    height: contactNode.CONTACT_BLOCK_HEIGHT,
    gapBetweenNodes: 55,
    handle: {
      x: contactNode.CONTACT_CONNECTOR_X,
      y: contactNode.CONTACT_CONNECTOR_Y,
      offsetY: 0,
    },
  },
  powerRail: {
    width: powerRailNode.POWER_RAIL_WIDTH,
    height: powerRailNode.POWER_RAIL_HEIGHT,
    gapBetweenNodes: 0,
    handle: {
      x: powerRailNode.POWER_RAIL_CONNECTOR_X,
      y: powerRailNode.POWER_RAIL_CONNECTOR_Y,
      offsetY: 0,
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
  block: blockNode.buildBlockNode,
  contact: contactNode.buildContactNode,
  powerRail: powerRailNode.buildPowerRailNode,
  mockNode: mockNode.buildMockNode,
}
