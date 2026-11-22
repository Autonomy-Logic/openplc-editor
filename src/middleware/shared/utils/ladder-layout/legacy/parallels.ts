import type { Edge, Node } from '@xyflow/react'

import type { RungLadderState } from '../../../ports/types'
import { getDefaultNodeStyle, LEGACY_PARALLEL_PAIR_GAP } from '../legacy-style'
import { connectorIdOf, connectorOf, missing } from './node-access'

/** A node's position and the flow position of its main handle. */
export type LegacyNodePosition = { posX: number; posY: number; handleX: number; handleY: number }

/** The elements wired into a node: on its serial input, on a parallel close's lower input, and both. */
export type LegacyPreviousElements = {
  nodes: { serial: Node[]; parallel: Node[]; all: Node[] }
  edges: Edge[]
}

/** One parallel region (an open/close pair) with its nesting depth and the nodes on each of its paths. */
export type LegacyParallelRegion = {
  parent: Node | undefined
  parallels: {
    open: Node
    close: Node
  }
  depth: number
  height: number
  highestNode: Node
  nodes: {
    serial: Node[]
    parallel: Node[]
  }
}

/** Every parallel region reached from one open parallel, keyed by the id of the region's open node. */
export type LegacyParallelRegions = Record<string, LegacyParallelRegion>

/**
 * The elements wired into `node`, skipping variable boxes and branch elements; edges into a parallel close's
 * parallel input count as parallel predecessors.
 */
export const getPreviousElementsByEdge = (rung: RungLadderState, node: Node): LegacyPreviousElements => {
  const { edges } = rung
  const lastNodes: LegacyPreviousElements = {
    nodes: { serial: [], parallel: [], all: [] },
    edges: [],
  }

  const connectedEdges = edges.filter((e) => e.target === node.id)
  if (connectedEdges.length === 0) {
    return lastNodes
  }

  connectedEdges.forEach((e) => {
    const n = rung.nodes.find((candidate) => candidate.id === e.source)
    if (!n || n.type === 'variable') return
    if (n.data.branchContext) return

    if (
      node.type === 'parallel' &&
      node.data.type === 'close' &&
      e.targetHandle === connectorIdOf(node.data, 'parallelInputConnector')
    ) {
      lastNodes.nodes.parallel.push({ ...n })
      return
    }

    lastNodes.nodes.serial.push({ ...n })
  })
  lastNodes.nodes.all = [...lastNodes.nodes.serial, ...lastNodes.nodes.parallel]
  const allNodeIds = new Set(lastNodes.nodes.all.map((n) => n.id))
  lastNodes.edges = connectedEdges.filter((e) => allNodeIds.has(e.source))

  return lastNodes
}

/**
 * Where `newElement` (a node or a node type) goes after `previousElement`, on its serial output or, for `parallel`,
 * on its parallel output.
 */
export const getNodePositionBasedOnPreviousNode = (
  previousElement: Node,
  newElement: string | Node,
  type: 'serial' | 'parallel',
): LegacyNodePosition => {
  const previousElementOutputHandle =
    connectorOf(previousElement.data, type === 'parallel' ? 'parallelOutputConnector' : 'outputConnector') ??
    missing(`${type} output connector of ${previousElement.id}`)
  const previousElementStyle = getDefaultNodeStyle({ node: previousElement })
  const newNodeStyle = getDefaultNodeStyle(
    typeof newElement === 'string' ? { nodeType: newElement } : { node: newElement },
  )

  const parallelNodeCheckingParallelNode =
    previousElement.type === 'parallel' &&
    (typeof newElement === 'string' ? newElement === 'parallel' : newElement.type === 'parallel')

  let gap = 0
  if (parallelNodeCheckingParallelNode) {
    if (
      typeof newElement === 'string' ||
      (previousElement.data.type === 'close' &&
        newElement.data.type === 'open' &&
        previousElement.id !== newElement.data.parallelCloseReference)
    ) {
      gap = LEGACY_PARALLEL_PAIR_GAP
    }
  } else {
    gap = previousElementStyle.gap + newNodeStyle.gap
  }

  const offsetY = newNodeStyle.handle.y
  const x = previousElement.position.x + (!parallelNodeCheckingParallelNode ? previousElement.width || 0 : 0) + gap

  return {
    posX: x,
    posY:
      previousElement.type === (typeof newElement === 'string' ? newElement : newElement.type)
        ? previousElement.position.y
        : previousElementOutputHandle.glbPosition.y - offsetY,
    handleX: x,
    handleY: previousElementOutputHandle.glbPosition.y,
  }
}

/** The outermost open parallels of a rung, in node order. */
export const findParallelsInRung = (rung: RungLadderState): Node[] => {
  const parallels: Node[] = []
  let isAnotherParallel = true
  let parallel: Node | undefined = undefined
  rung.nodes.forEach((node) => {
    if (isAnotherParallel && node.type === 'parallel' && node.data.type === 'open') {
      parallels.push(node)
      parallel = node
      isAnotherParallel = false
    }
    if (
      !isAnotherParallel &&
      node.type === 'parallel' &&
      node.data.type === 'close' &&
      parallel?.data.parallelCloseReference === node.id
    ) {
      isAnotherParallel = true
    }
  })
  return parallels
}

/**
 * Every parallel region nested in the region opened by `openParallel`, with its depth, parent, tallest serial node
 * and the nodes on its serial and parallel paths.
 */
export const findAllParallelsDepthAndNodes = (
  rung: RungLadderState,
  openParallel: Node,
  depth: number = 0,
  parentNode: Node | undefined = undefined,
): LegacyParallelRegions => {
  let objectParallel: LegacyParallelRegions = {}

  const closeNode =
    rung.nodes.find((node) => node.id === openParallel.data.parallelCloseReference) ??
    missing(`close parallel of ${openParallel.id}`)
  const nodesInsideParallel = getNodesInsideParallel(rung, closeNode)

  const serialNodes = nodesInsideParallel.serial
  let highestNode = serialNodes[0] ?? missing(`serial path of ${openParallel.id}`)
  let serialHeight = highestNode.height ?? 0
  for (const serialNode of serialNodes) {
    if (serialNode.type === 'parallel' && serialNode.data.type === 'open') {
      const object = findAllParallelsDepthAndNodes(rung, serialNode, depth, openParallel)
      objectParallel = { ...objectParallel, ...object }
    }
    if (serialHeight < (serialNode.height ?? 0)) {
      serialHeight = serialNode.height ?? 0
      highestNode = serialNode
    }
  }

  let deepestDepth = 0
  for (const objects in objectParallel) {
    const object = objectParallel[objects]
    deepestDepth = Math.max(deepestDepth, object.depth)
  }
  deepestDepth = deepestDepth === depth || depth > deepestDepth ? depth + 1 : deepestDepth

  for (const parallelNode of nodesInsideParallel.parallel) {
    if (parallelNode.data.type === 'open') {
      const object = findAllParallelsDepthAndNodes(rung, parallelNode, deepestDepth, openParallel)
      objectParallel = { ...objectParallel, ...object }
    }
  }

  objectParallel[openParallel.id] = {
    parent: parentNode,
    depth,
    height: serialHeight,
    highestNode,
    parallels: {
      open: openParallel,
      close: closeNode,
    },
    nodes: {
      serial: nodesInsideParallel.serial,
      parallel: nodesInsideParallel.parallel,
    },
  }

  return objectParallel
}

/** The nodes between a parallel close and its open, split into the serial path and the parallel path. */
export const getNodesInsideParallel = (
  rung: RungLadderState,
  closeParallelNode: Node,
): { serial: Node[]; parallel: Node[] } => {
  const openParallelNode =
    rung.nodes.find((node) => node.id === closeParallelNode.data.parallelOpenReference) ??
    missing(`open parallel of ${closeParallelNode.id}`)
  const serial: Node[] = []
  const parallel: Node[] = []
  const serialConnectorId = connectorIdOf(openParallelNode.data, 'outputConnector')

  const openParallelEdges = rung.edges.filter((edge) => edge.source === openParallelNode.id)
  for (const parallelEdge of openParallelEdges) {
    let nextEdge: Edge | undefined = parallelEdge
    while (nextEdge && nextEdge.target !== closeParallelNode.id) {
      const target: string = nextEdge.target
      const node = rung.nodes.find((n) => n.id === target)
      if (!node) break
      const outputId = connectorIdOf(node.data, 'outputConnector')
      nextEdge = rung.edges.find((edge) => edge.source === target && edge.sourceHandle === outputId)
      if (parallelEdge.sourceHandle === serialConnectorId) serial.push(node)
      else parallel.push(node)
    }
  }

  return { serial, parallel }
}
