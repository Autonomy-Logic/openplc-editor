import * as blockNode from './block'

export const customNodeTypes = {
  block: blockNode.Block,
}

export const nodesBuilder = {
  block: blockNode.buildBlockNode,
}
