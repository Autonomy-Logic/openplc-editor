import type { Edge, Node } from '@xyflow/react'

import type { RungLadderState } from '../../ports/types'
import { connectorIdOf, handleIdOf, handlesOf } from './legacy/node-access'
import { getRecord, getString } from './node-data'

/** A contact or a coil. */
export interface LdCell {
  kind: 'cell'
  node: Node
}

/** A series of elements hanging on a block pin, and the rail handle that feeds or drains it. */
export interface LdNetwork {
  elements: LdElement[]
  railHandleId: string | undefined
}

/** What one side of a block row holds: its pin, the pin variable node and the network on the pin. */
export interface LdPin {
  handleId: string
  variable: Node | undefined
  network: LdNetwork | undefined
}

/** One pin row of a block: the input pin on the left, the output pin on the right. */
export interface LdPinRow {
  input: LdPin | undefined
  output: LdPin | undefined
}

export interface LdBlock {
  kind: 'block'
  node: Node
  rows: LdPinRow[]
}

/** A parallel group: one open/close pair, or a stack of pairs, with its branches top to bottom. */
export interface LdGroup {
  kind: 'group'
  opens: Node[]
  closes: Node[]
  branches: LdElement[][]
}

export type LdElement = LdCell | LdBlock | LdGroup

/** A rung read as series and parallel elements between its rails, from its nodes and edges. */
export interface LdRungStructure {
  leftRail: Node | undefined
  rightRail: Node | undefined
  main: LdElement[]
  /** Rail handle id of each left-rail network start edge, and of each right-rail network end edge. */
  railHandles: ReadonlyMap<string, LdNetwork>
}

interface SeriesResult {
  elements: LdElement[]
  end: Edge | undefined
}

const pinKey = (blockId: string, handleId: string, side: string): string => `${blockId}\u0000${handleId}\u0000${side}`

/** True for the rung's power rail on the given side, by its variant or its `left-rail` / `right-rail` id prefix. */
function isRail(node: Node, side: 'left' | 'right'): boolean {
  return node.type === 'powerRail' && (getString(node.data, 'variant') === side || node.id.startsWith(`${side}-rail`))
}

/** The ids of a node's stored handles under `key`, keeping only string ids. */
function handleIds(node: Node, key: string): string[] {
  return handlesOf(node.data, key).flatMap((handle) => {
    const id = handleIdOf(handle)
    return id === undefined ? [] : [id]
  })
}

/** Reads a rung's graph into series, parallel groups, blocks with their pin rows and the networks on their pins. */
class StructureReader {
  private readonly byId: Map<string, Node>
  private readonly outgoing = new Map<string, Edge[]>()
  private readonly pinVariables = new Map<string, Node>()
  private readonly visited = new Set<string>()
  private readonly blocks: LdBlock[] = []
  private readonly inputNetworks = new Map<string, LdNetwork>()
  readonly railHandles = new Map<string, LdNetwork>()

  constructor(private readonly rung: RungLadderState) {
    this.byId = new Map(rung.nodes.map((node) => [node.id, node]))
    for (const edge of rung.edges) this.outgoing.set(edge.source, [...(this.outgoing.get(edge.source) ?? []), edge])
    for (const node of rung.nodes) {
      if (node.type !== 'variable') continue
      const block = getRecord(node.data, 'block')
      const blockId = getString(block, 'id')
      const handleId = getString(block, 'handleId')
      const side = getString(node.data, 'variant')
      if (blockId === undefined || handleId === undefined || side === undefined) continue
      const key = pinKey(blockId, handleId, side)
      if (!this.pinVariables.has(key)) this.pinVariables.set(key, node)
    }
  }

  read(): LdRungStructure {
    const leftRail = this.rung.nodes.find((node) => isRail(node, 'left'))
    const rightRail = this.rung.nodes.find((node) => isRail(node, 'right'))
    const railEdges = leftRail === undefined ? [] : (this.outgoing.get(leftRail.id) ?? [])
    const mainHandle = leftRail === undefined ? undefined : connectorIdOf(leftRail.data, 'outputConnector')
    const mainEdge =
      railEdges.find((edge) => edge.sourceHandle === mainHandle) ??
      railEdges.find((edge) => !(edge.sourceHandle ?? '').startsWith('branch_'))
    if (leftRail !== undefined) this.visited.add(leftRail.id)
    if (rightRail !== undefined) this.visited.add(rightRail.id)

    const main = this.series(mainEdge, () => false).elements
    for (const edge of railEdges) {
      if (edge === mainEdge) continue
      const { elements, end } = this.series(edge, (_, target) => target.type === 'block')
      const target = end === undefined ? undefined : this.byId.get(end.target)
      if (end === undefined || target?.type !== 'block' || typeof end.targetHandle !== 'string') continue
      const network: LdNetwork = { elements, railHandleId: edge.sourceHandle ?? undefined }
      this.inputNetworks.set(pinKey(target.id, end.targetHandle, 'input'), network)
      if (network.railHandleId !== undefined) this.railHandles.set(network.railHandleId, network)
    }
    for (let index = 0; index < this.blocks.length; index++) this.fillRows(this.blocks[index])
    return { leftRail, rightRail, main, railHandles: this.railHandles }
  }

  /** Follows wires from `first` while each target is a new contact, coil, block or opening parallel node. */
  private series(first: Edge | undefined, stop: (edge: Edge, target: Node) => boolean): SeriesResult {
    const elements: LdElement[] = []
    let edge = first
    while (edge !== undefined) {
      const target = this.byId.get(edge.target)
      if (target === undefined || this.visited.has(target.id) || stop(edge, target)) return { elements, end: edge }
      if (target.type === 'contact' || target.type === 'coil' || target.type === 'block') {
        handlesOf(target.data, 'handles')
        this.visited.add(target.id)
        if (target.type === 'block') {
          const block: LdBlock = { kind: 'block', node: target, rows: [] }
          this.blocks.push(block)
          elements.push(block)
        } else {
          elements.push({ kind: 'cell', node: target })
        }
        edge = this.continuation(target)
        continue
      }
      if (target.type === 'parallel' && getString(target.data, 'type') === 'open') {
        const group = this.group(target)
        if (group === undefined) return { elements, end: edge }
        elements.push(group)
        edge = this.closeContinuation(group.closes[0])
        continue
      }
      return { elements, end: edge }
    }
    return { elements, end: undefined }
  }

  /** The group an opening node starts; a lower branch that is exactly one group is a stacked pair and joins it. */
  private group(open: Node): LdGroup | undefined {
    const closeId = getString(open.data, 'parallelCloseReference')
    const close = closeId === undefined ? undefined : this.byId.get(closeId)
    if (close === undefined || this.visited.has(close.id)) return undefined
    handlesOf(open.data, 'handles')
    handlesOf(close.data, 'handles')
    this.visited.add(open.id)
    this.visited.add(close.id)
    const untilClose = (_: Edge, target: Node): boolean => target.id === close.id
    const top = this.series(this.edgeFrom(open, 'outputConnector', 'output-right'), untilClose).elements
    const lower = this.series(this.edgeFrom(open, 'parallelOutputConnector', 'output-down'), untilClose).elements
    const [only] = lower
    if (lower.length === 1 && only.kind === 'group') {
      return {
        kind: 'group',
        opens: [open, ...only.opens],
        closes: [close, ...only.closes],
        branches: [top, ...only.branches],
      }
    }
    return { kind: 'group', opens: [open], closes: [close], branches: [top, lower] }
  }

  /** The wire leaving `node` on the handle its connector `key` names, or `fallback` when the connector is missing. */
  private edgeFrom(node: Node, key: string, fallback: string): Edge | undefined {
    const handle = connectorIdOf(node.data, key) ?? fallback
    return (this.outgoing.get(node.id) ?? []).find((edge) => edge.sourceHandle === handle)
  }

  /** The wire leaving a closing node: on its output connector, else its parallel output, else any. */
  private closeContinuation(close: Node): Edge | undefined {
    const edges = this.outgoing.get(close.id) ?? []
    const output = connectorIdOf(close.data, 'outputConnector')
    const parallelOutput = connectorIdOf(close.data, 'parallelOutputConnector')
    return (
      edges.find((edge) => edge.sourceHandle === output) ??
      edges.find((edge) => edge.sourceHandle === parallelOutput) ??
      edges[0]
    )
  }

  /** The series wire leaving a contact, coil or block: on its output connector, else one that leaves no other pin. */
  private continuation(node: Node): Edge | undefined {
    const edges = this.outgoing.get(node.id) ?? []
    const output = connectorIdOf(node.data, 'outputConnector')
    const exact = edges.find((edge) => edge.sourceHandle === output)
    if (exact !== undefined) return exact
    const otherPins = new Set(handleIds(node, 'handles'))
    return edges.find(
      (edge) =>
        this.byId.get(edge.target)?.type !== 'variable' &&
        !(typeof edge.sourceHandle === 'string' && otherPins.has(edge.sourceHandle)),
    )
  }

  /** Builds a block's pin rows: row i holds its i-th input and i-th output pin, with their variable or network. */
  private fillRows(block: LdBlock): void {
    const { node } = block
    const inputs = handleIds(node, 'inputHandles')
    const outputs = handleIds(node, 'outputHandles')
    const mainOutput = connectorIdOf(node.data, 'outputConnector')
    const count = Math.max(1, inputs.length, outputs.length)
    for (let row = 0; row < count; row++) {
      const input = row < inputs.length ? inputs[row] : undefined
      const output = row < outputs.length ? outputs[row] : undefined
      block.rows.push({
        input:
          input === undefined
            ? undefined
            : {
                handleId: input,
                variable: this.pinVariables.get(pinKey(node.id, input, 'input')),
                network: this.inputNetworks.get(pinKey(node.id, input, 'input')),
              },
        output:
          output === undefined
            ? undefined
            : {
                handleId: output,
                variable: this.pinVariables.get(pinKey(node.id, output, 'output')),
                network: output === mainOutput ? undefined : this.outputNetwork(node, output),
              },
      })
    }
  }

  /** The network wired from a block's secondary output pin towards the right rail, if any. */
  private outputNetwork(block: Node, handleId: string): LdNetwork | undefined {
    const first = (this.outgoing.get(block.id) ?? []).find(
      (edge) => edge.sourceHandle === handleId && this.byId.get(edge.target)?.type !== 'variable',
    )
    if (first === undefined) return undefined
    const { elements, end } = this.series(first, () => false)
    if (elements.length === 0) return undefined
    const target = end === undefined ? undefined : this.byId.get(end.target)
    const railHandleId =
      end !== undefined && target !== undefined && isRail(target, 'right') && typeof end.targetHandle === 'string'
        ? end.targetHandle
        : undefined
    const network: LdNetwork = { elements, railHandleId }
    if (railHandleId !== undefined) this.railHandles.set(railHandleId, network)
    return network
  }
}

/** Reads a rung's graph into its main series, parallel groups and block pin networks; never changes the rung. */
export function readRungStructure(rung: RungLadderState): LdRungStructure {
  return new StructureReader(rung).read()
}
