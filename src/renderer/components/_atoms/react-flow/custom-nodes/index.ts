import * as blockNode from './block'
import * as coilNode from './coil'
import * as contactNode from './contact'
import * as mockNode from './mock-node'
import * as parallelNode from './parallel'
import * as placeholderNode from './placeholder'
import * as powerRailNode from './power-rail'

export const DEFAULT_NODES_GAP = 50

export const customNodeTypes = {
  block: blockNode.Block,
  coil: coilNode.Coil,
  contact: contactNode.Contact,
  parallel: parallelNode.Parallel,
  parallelPlaceholder: placeholderNode.Placeholder,
  placeholder: placeholderNode.Placeholder,
  powerRail: powerRailNode.PowerRail,
  mockNode: mockNode.MockNode,
}

type CustomNodeTypes = {
  [key: string]: {
    width: number
    height: number
    gap: number
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
    gap: 80,
    handle: {
      x: blockNode.BLOCK_CONNECTOR_X,
      y: blockNode.BLOCK_CONNECTOR_Y,
      offsetY: blockNode.BLOCK_CONNECTOR_Y_OFFSET,
    },
  },
  coil: {
    width: coilNode.COIL_BLOCK_WIDTH,
    height: coilNode.COIL_BLOCK_HEIGHT,
    gap: 55,
    handle: {
      x: coilNode.COIL_CONNECTOR_X,
      y: coilNode.COIL_CONNECTOR_Y,
      offsetY: 0,
    },
  },
  contact: {
    width: contactNode.CONTACT_BLOCK_WIDTH,
    height: contactNode.CONTACT_BLOCK_HEIGHT,
    gap: 55,
    handle: {
      x: contactNode.CONTACT_CONNECTOR_X,
      y: contactNode.CONTACT_CONNECTOR_Y,
      offsetY: 0,
    },
  },
  parallel: {
    width: parallelNode.PARALLEL_WIDTH,
    height: parallelNode.PARALLEL_HEIGHT,
    gap: parallelNode.GAP,
    handle: {
      x: 0,
      y: parallelNode.PARALLEL_CONNECTOR_Y,
      offsetY: 0,
    },
  },
  parallelPlaceholder: {
    width: placeholderNode.PLACEHOLDER_WIDTH,
    height: placeholderNode.PLACEHOLDER_HEIGHT,
    gap: 0,
    handle: {
      x: 0,
      y: placeholderNode.PLACEHOLDER_CONNECTOR_Y,
      offsetY: 0,
    },
  },
  placeholder: {
    width: placeholderNode.PLACEHOLDER_WIDTH,
    height: placeholderNode.PLACEHOLDER_HEIGHT,
    gap: 0,
    handle: {
      x: 0,
      y: placeholderNode.PLACEHOLDER_CONNECTOR_Y,
      offsetY: 0,
    },
  },
  powerRail: {
    width: powerRailNode.POWER_RAIL_WIDTH,
    height: powerRailNode.POWER_RAIL_HEIGHT,
    gap: 20,
    handle: {
      x: powerRailNode.POWER_RAIL_CONNECTOR_X,
      y: powerRailNode.POWER_RAIL_CONNECTOR_Y,
      offsetY: 0,
    },
  },
  mockNode: {
    width: 150,
    height: 40,
    gap: 50,
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
  mockNode: mockNode.buildMockNode,
}
