import * as blockNode from './block'
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
export const CustomFBDNodeKeys = Object.keys(customNodeTypes)
export type CustomFbdNodeTypes = keyof typeof customNodeTypes

export const nodesBuilder = {
  block: blockNode.buildBlockNode,
  variable: variableNode.buildVariableNode,
  connection: connectionNode.buildConnectionNode,
  comment: commentNode.buildCommentNode,
}
