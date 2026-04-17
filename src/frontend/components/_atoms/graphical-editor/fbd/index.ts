import * as blockNode from './block'
import * as buildNodes from './buildNodes'
import * as commentNode from './comment'
import * as connectionNode from './connection'
import * as variableNode from './variable'

export const customNodeTypes = {
  block: blockNode.Block,
  'input-variable': variableNode.VariableElement,
  'output-variable': variableNode.VariableElement,
  'inout-variable': variableNode.VariableElement,
  connector: connectionNode.ConnectionElement,
  continuation: connectionNode.ConnectionElement,
  comment: commentNode.CommentElement,
}
export type CustomFbdNodeTypes = keyof typeof customNodeTypes

export const nodesBuilder = {
  block: buildNodes.buildBlockNode,
  variable: buildNodes.buildVariableNode,
  connection: buildNodes.buildConnectionNode,
  comment: buildNodes.buildCommentNode,
}
