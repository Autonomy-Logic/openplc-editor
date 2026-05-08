import type { Node, NodeProps } from '@xyflow/react'
import { ReactNode } from 'react'

import { HandleBranch, PLCVariable } from '../../../../../../middleware/shared/ports'
import { CustomHandleProps } from '../handle'

export type { HandleBranch }

export type BuilderBasicProps = {
  id: string
  posX: number
  posY: number
  handleX: number
  handleY: number
}

/**
 * Marker placed on contact / coil / parallel nodes that live inside a handle
 * branch (the mini-rung attached to a function-block input or output handle).
 *
 * Block / variable / power-rail / placeholder nodes intentionally do NOT carry
 * this marker — having `branchContext` on those types would model invalid
 * states (a block can't be a branch element, a variable is replaced by a
 * branch, etc.). Restricting it at the type level catches misuse at compile
 * time.
 *
 * Derived from `HandleBranch` so the shared field set stays consistent —
 * `branchContext` is the per-node marker, `HandleBranch` adds `nodeIds` to
 * become the per-rung index.
 */
export type BranchContext = Omit<HandleBranch, 'nodeIds'>

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
export type BlockNode<T> = Node<BlockNodeData<T>, 'block'>
export type BlockProps<T> = NodeProps<BlockNode<T>>
export type BlockBuilderProps<T> = BuilderBasicProps & { variant: T; executionControl?: boolean }

// coil

export type CoilNodeData = BasicNodeData & {
  variant: 'default' | 'negated' | 'risingEdge' | 'fallingEdge' | 'set' | 'reset'
  branchContext?: BranchContext
}
export type CoilNode = Node<CoilNodeData, 'coil'>
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

export type ContactNodeData = BasicNodeData & {
  variant: 'default' | 'negated' | 'risingEdge' | 'fallingEdge'
  branchContext?: BranchContext
}
export type ContactNode = Node<ContactNodeData, 'contact'>
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

export type ParallelNodeData = BasicNodeData & {
  parallelInputConnector: CustomHandleProps | undefined
  parallelOutputConnector: CustomHandleProps | undefined
  parallelOpenReference: string | undefined
  parallelCloseReference: string | undefined
  type: 'open' | 'close'
  branchContext?: BranchContext
}
export type ParallelNode = Node<ParallelNodeData, 'parallel'>
export type ParallelProps = NodeProps<ParallelNode>
export type ParallelBuilderProps = BuilderBasicProps & { type: 'open' | 'close' }

// placeholder

/**
 * Marker on a placeholder that says "drop here to create or extend a handle
 * branch on this block input/output." Distinguishes branch-target placeholders
 * from regular main-rail / parallel placeholders.
 *
 * Variants:
 *   - no `insertIndex`, no `parallelPathSplice`: "create" placeholder over the
 *     Variable node slot. Routes to `replaceVariableWithBranch`.
 *   - `insertIndex` only: "splice" placeholder in the spine at that index.
 *     Routes to `insertIntoBranch`. Or, when the placeholder is of type
 *     `parallelPlaceholder`, it routes to `startParallelInBranch` /
 *     `addPathToBranchParallel` and `insertIndex` identifies which spine
 *     element is being parallelized.
 *   - `parallelPathSplice`: "splice into a parallel-path's serial chain" —
 *     `parallelOpenId` identifies which OPEN's parallel paths we're acting
 *     on, `predecessorId` and `successorId` are the existing parallel-path
 *     elements (or OPEN/CLOSE) the new element splices between.
 */
export type HandleBranchTarget = BranchContext & {
  insertIndex?: number
  parallelPathSplice?: {
    parallelOpenId: string
    predecessorId: string
    successorId: string
  }
}

export type PlaceholderNodeData = BasicNodeData & {
  relatedNode: Node | undefined
  position: 'left' | 'right' | 'bottom'
  handleBranchTarget?: HandleBranchTarget
}
export type PlaceholderNode = Node<PlaceholderNodeData, 'placeholder' | 'parallelPlaceholder'>
export type PlaceholderProps = NodeProps<PlaceholderNode>
export type PlaceholderBuilderProps = BuilderBasicProps & {
  type: 'parallel' | 'default'
  relatedNode: Node | undefined
  position: 'left' | 'right' | 'bottom'
}

// power rail

export type PowerRailNodeData = BasicNodeData & { variant: 'left' | 'right' }
export type PowerRailNode = Node<PowerRailNodeData, 'powerRail'>
export type PowerRailProps = NodeProps<PowerRailNode>
/**
 * Dynamic handle on a power rail that anchors a handle branch.
 *
 * Direction follows the branch's flow:
 *   - input branches start at the left rail and feed into a block input,
 *     so on a left rail (`variant: 'right'`) the handle is a `source`.
 *   - output branches start at a block output and end at the right rail,
 *     so on a right rail (`variant: 'left'`) the handle is a `target`.
 *
 * `y` is relative to the rail's top edge (top = 0).
 */
export type RailBranchHandle = {
  id: string
  y: number
  direction: 'input' | 'output'
}

export type PowerRailBuilderProps = BuilderBasicProps & {
  connector: 'left' | 'right'
  branchHandles?: RailBranchHandle[]
}

// variable

export type VariableNodeData = BasicNodeData & {
  variant: 'input' | 'output'
  block: {
    id: string
    handleId: string
    variableType: BlockVariant['variables'][0]
  }
}
export type VariableNode = Node<VariableNodeData, 'variable'>
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

// rung-node discriminated union

/**
 * Every node type that may appear in a `RungLadderState['nodes']` array,
 * discriminated by its literal `type` field. Use this in place of the generic
 * `Node` from `@xyflow/react` so callers can narrow on `node.type` instead of
 * casting `as BlockNode<...>` etc.
 */
export type RungNode =
  | BlockNode<BlockVariant>
  | CoilNode
  | ContactNode
  | ParallelNode
  | PlaceholderNode
  | PowerRailNode
  | VariableNode
