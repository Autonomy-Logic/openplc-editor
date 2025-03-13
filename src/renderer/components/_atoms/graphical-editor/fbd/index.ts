import * as blockNode from './block'
import * as variableNode from './variable'

export const customNodeTypes = {
  block: blockNode.Block,
  'input-variable': variableNode.VariableElement,
  'output-variable': variableNode.VariableElement,
  'inout-variable': variableNode.VariableElement,
}
export type CustomNodeTypes = keyof typeof customNodeTypes

export const nodesBuilder = {
  block: blockNode.buildBlockNode,
  variable: variableNode.buildVariableNode,
}
