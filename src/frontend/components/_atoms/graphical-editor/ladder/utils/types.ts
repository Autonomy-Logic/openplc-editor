import type { Node, NodeProps } from '@xyflow/react'
import { ReactNode } from 'react'

import { PLCVariable } from '../../../../../../middleware/shared/ports'
import type { HandleBranch } from '../../../../../../middleware/shared/ports/types'
import { CustomHandleProps } from '../handle'

// HandleBranch is defined in the ports layer (where RungLadderState lives) so
// the rung type can reference it without violating layer rules. Re-export it
// here so component code can import it from a single nearby location.
export type { HandleBranch }

export type BuilderBasicProps = {
  id: string
  posX: number
  posY: number
  handleX: number
  handleY: number
}

export type BasicNodeData = {
  handles: CustomHandleProps[]
  inputHandles: CustomHandleProps[]
  outputHandles: CustomHandleProps[]
  inputConnector: CustomHandleProps | undefined
  outputConnector: CustomHandleProps | undefined
  numericId: string
  variable: { id?: string; name: string } | PLCVariable
  executionOrder: number
  draggable: boolean
  selectable: boolean
  deletable: boolean
  /** Marks this node as part of a handle branch (contact/coil on a block input/output) */
  branchContext?: {
    blockId: string
    handleId: string
    direction: 'input' | 'output'
  }
  /** Set on placeholders to indicate dropping here creates a handle branch */
  handleBranchTarget?: {
    blockId: string
    handleId: string
    direction: 'input' | 'output'
    handlePosition: { x: number; y: number }
    /** When set, insert into existing branch at this position in nodeIds. When undefined, create new branch. */
    insertIndex?: number
  }
}

// block

export type BlockVariant = {
  name: string
  type: string
  variables: { id?: string; name: string; class: string; type: { definition: string; value: string } }[]
  documentation: string
  extensible: boolean
}
export type LadderBlockConnectedVariables = {
  handleId: string
  handleTableId?: string
  type: 'input' | 'output'
  variable: PLCVariable | undefined
}[]

export type BlockNodeData<T> = BasicNodeData & {
  variant: T
  executionControl: boolean
  lockExecutionControl: boolean
  connectedVariables: LadderBlockConnectedVariables
  variable: { id?: string; name: string } | PLCVariable
  hasDivergence?: boolean
}
export type BlockNode<T> = Node<BlockNodeData<T>>
export type BlockProps<T> = NodeProps<BlockNode<T>>
export type BlockBuilderProps<T> = BuilderBasicProps & { variant: T; executionControl?: boolean }

// coil

export type CoilNode = Node<
  BasicNodeData & {
    variant: 'default' | 'negated' | 'risingEdge' | 'fallingEdge' | 'set' | 'reset'
  }
>
export type CoilProps = NodeProps<CoilNode>
export type CoilBuilderProps = BuilderBasicProps & {
  variant: 'default' | 'negated' | 'risingEdge' | 'fallingEdge' | 'set' | 'reset'
}

export type CoilType = {
  [key in CoilNode['data']['variant']]: {
    svg: (wrongVariable: boolean, debuggerColor?: string) => ReactNode
  }
}

// contact

export type ContactNode = Node<BasicNodeData & { variant: 'default' | 'negated' | 'risingEdge' | 'fallingEdge' }>
export type ContactProps = NodeProps<ContactNode>
export type ContactBuilderProps = BuilderBasicProps & { variant: 'default' | 'negated' | 'risingEdge' | 'fallingEdge' }

export type ContactType = {
  [key in ContactNode['data']['variant']]: {
    svg: (wrongVariable: boolean, debuggerColor?: string) => ReactNode
  }
}

// mock

export type MockNode = Node<{ label: string; handles: CustomHandleProps[] }, 'text'>
export type MockNodeProps = NodeProps<MockNode>

// parallel

export type ParallelNode = Node<
  BasicNodeData & {
    parallelInputConnector: CustomHandleProps | undefined
    parallelOutputConnector: CustomHandleProps | undefined
    parallelOpenReference: string | undefined
    parallelCloseReference: string | undefined
    type: 'open' | 'close'
  }
>
export type ParallelProps = NodeProps<ParallelNode>
export type ParallelBuilderProps = BuilderBasicProps & { type: 'open' | 'close' }

// placeholder

export type PlaceholderNode = Node<
  BasicNodeData & { relatedNode: Node | undefined; position: 'left' | 'right' | 'bottom' }
>
export type PlaceholderProps = NodeProps<PlaceholderNode>
export type PlaceholderBuilderProps = BuilderBasicProps & {
  type: 'parallel' | 'default'
  relatedNode: Node | undefined
  position: 'left' | 'right' | 'bottom'
}

// power rail

export type PowerRailNode = Node<BasicNodeData & { variant: 'left' | 'right' }>
export type PowerRailProps = NodeProps<PowerRailNode>
export type PowerRailBuilderProps = BuilderBasicProps & { connector: 'left' | 'right' }

// variable

export type VariableNode = Node<
  BasicNodeData & {
    variant: 'input' | 'output'
    block: {
      id: string
      handleId: string
      variableType: BlockVariant['variables'][0]
    }
  }
>
export type VariableProps = NodeProps<VariableNode>
export type VariableBuilderProps = BuilderBasicProps & {
  variant: 'input' | 'output'
  block: {
    id: string
    handleId: string
    variableType: BlockVariant['variables'][0]
  }
  variable: PLCVariable | undefined
}
