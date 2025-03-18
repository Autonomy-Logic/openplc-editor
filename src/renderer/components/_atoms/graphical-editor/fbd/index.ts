import * as blockNode from './block'
import * as connectionNode from './connection'
import * as variableNode from './variable'

export const customNodeTypes = {
  block: blockNode.Block,
  'input-variable': variableNode.VariableElement,
  'output-variable': variableNode.VariableElement,
  'inout-variable': variableNode.VariableElement,
  'connector': connectionNode.ConnectionElement,
  'continuation': connectionNode.ConnectionElement,
}
export type CustomFbdNodeTypes = keyof typeof customNodeTypes

export const nodesBuilder = {
  block: blockNode.buildBlockNode,
  variable: variableNode.buildVariableNode,
  connection: connectionNode.buildConnectionNode,
}
