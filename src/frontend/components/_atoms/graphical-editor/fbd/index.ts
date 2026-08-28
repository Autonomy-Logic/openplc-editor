import * as blockNode from './block'
import * as buildNodes from './buildNodes'
import * as commentNode from './comment'
import * as connectionNode from './connection'
import * as executeNode from './execute'
import * as variableNode from './variable'

export const customNodeTypes = {
  block: blockNode.Block,
  'input-variable': variableNode.VariableElement,
  'output-variable': variableNode.VariableElement,
  'inout-variable': variableNode.VariableElement,
  connector: connectionNode.ConnectionElement,
  continuation: connectionNode.ConnectionElement,
  comment: commentNode.CommentElement,
  execute: executeNode.ExecuteElement,
}
export type CustomFbdNodeTypes = keyof typeof customNodeTypes

export const nodesBuilder = {
  block: buildNodes.buildBlockNode,
  variable: buildNodes.buildVariableNode,
  connection: buildNodes.buildConnectionNode,
  comment: buildNodes.buildCommentNode,
  execute: buildNodes.buildExecuteNode,
}
