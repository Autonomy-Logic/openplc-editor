import { Node, NodeProps, XYPosition } from '@xyflow/react'

import type { PLCVariable } from '../../../../../../middleware/shared/ports/types'
import { CustomHandleProps } from '../handle'

export type BuilderBasicProps = {
  id: string
  position: XYPosition
}

export type BasicNodeData = {
  handles: CustomHandleProps[]
  inputHandles: CustomHandleProps[]
  outputHandles: CustomHandleProps[]
  inputConnector: CustomHandleProps | undefined
  outputConnector: CustomHandleProps | undefined
  numericId: string
  executionOrder: number
  variable: { id?: string; name: string } | PLCVariable
  draggable: boolean
  selectable: boolean
  deletable: boolean
}

// block

export type BlockNodeData<T> = BasicNodeData & {
  variant: T
  executionControl: boolean
  hasDivergence?: boolean
}
export type BlockNode<T> = Node<BlockNodeData<T>>
export type BlockProps<T> = NodeProps<BlockNode<T>>
export type BlockBuilderProps<T> = BuilderBasicProps & { variant: T; executionControl?: boolean }

// comment

export type CommentNode = Node<
  Pick<BasicNodeData, 'deletable' | 'draggable' | 'selectable' | 'numericId'> & {
    content: string
  }
>
export type CommentProps = NodeProps<CommentNode>
export type CommentBuilderProps = BuilderBasicProps

// connection

export type ConnectionNode = Node<
  BasicNodeData & {
    variant: 'connector' | 'continuation'
  }
>
export type ConnectionProps = NodeProps<ConnectionNode>
export type ConnectionBuilderProps = BuilderBasicProps & {
  variant: 'connector' | 'continuation'
  label?: string
}

// variable

export type VariableNode = Node<
  BasicNodeData & {
    variant: 'input-variable' | 'output-variable' | 'inout-variable'
    negated: boolean
  }
>
export type VariableProps = NodeProps<VariableNode>
export type VariableBuilderProps = BuilderBasicProps & {
  variant: 'input-variable' | 'output-variable' | 'inout-variable'
}

// execute ("ST Block")

/**
 * A box holding a raw Structured Text snippet.  `EN` gates execution;
 * `ENO` passes the same signal through.  Unlike the ladder variant this
 * one is free-positioned and user-resizable, matching the FBD comment
 * element.
 */
export type ExecuteNode = Node<BasicNodeData & { code: string }>
export type ExecuteProps = NodeProps<ExecuteNode>
export type ExecuteBuilderProps = BuilderBasicProps & { code?: string }
