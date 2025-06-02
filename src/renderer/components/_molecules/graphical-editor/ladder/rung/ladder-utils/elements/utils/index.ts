import type { CustomHandleProps } from '@root/renderer/components/_atoms/graphical-editor/ladder/handle'
import type { ParallelNode } from '@root/renderer/components/_atoms/graphical-editor/ladder/parallel'
import { BasicNodeData } from '@root/renderer/components/_atoms/graphical-editor/ladder/utils'
import type { RungLadderState } from '@root/renderer/store/slices'
import type { Edge, Node } from '@xyflow/react'

import { getDefaultNodeStyle, isNodeOfType } from '../../nodes'

/**
 * Get the previous element by searching with edge in the rung
 *
 * @param rung: RungLadderState
 * @param node: Node
 *
 * @returns obj: { nodes: { serial: Node[]; parallel: Node[]; all: Node[] }; edges: Edge[] }
 */
export const getPreviousElementsByEdge = (
  rung: RungLadderState,
  node: Node,
): { nodes: { serial: Node[]; parallel: Node[]; all: Node[] }; edges: Edge[] } => {
  const { edges } = rung
  const lastNodes: { nodes: { serial: Node[]; parallel: Node[]; all: Node[] }; edges: Edge[] } = {
    nodes: { serial: [], parallel: [], all: [] },
    edges: [],
  }

  // Get the connected edges to the node
  const connectedEdges = edges.filter((e) => e.target === node.id)
  // If there is no connected edges, return the last nodes
  if (connectedEdges.length === 0) {
    return lastNodes
  }

  connectedEdges.forEach((e) => {
    // Find the source of the edge
    const n = rung.nodes.find((n) => n.id === e.source)

    /**
     * If the node is undefined or an variable, skip it
     */
    if (!n || n.type === 'variable') return

    /**
     * If there is a parallel node, check if it is an open or close parallel
     * If it is a close parallel, add it to the parallel nodes
     */
    if (
      isNodeOfType(node, 'parallel') &&
      (node as ParallelNode).data.type === 'close' &&
      e.targetHandle === (node as ParallelNode).data.parallelInputConnector?.id
    ) {
      lastNodes.nodes.parallel.push({ ...n })
      return
    }

    lastNodes.nodes.serial.push({ ...n })
  })
  lastNodes.edges = connectedEdges
  lastNodes.nodes.all = [...lastNodes.nodes.serial, ...lastNodes.nodes.parallel]

  return lastNodes
}

/**
 * Get the previous node when adding a new element
 * It works when removing the placeholder and variables elements
 *
 * @param rung: RungLadderState
 * @param nodeIndex: number
 *
 * @returns Node
 */
export const getPreviousElement = (rung: RungLadderState, nodeIndex: number): Node => {
  const nodesWithNoPlaceholderAndVariables = rung.nodes.filter(
    (n) => n.type !== 'placeholder' && n.type !== 'parallelPlaceholder' && n.type !== 'variable',
  )
  return nodesWithNoPlaceholderAndVariables[nodeIndex - 1]
}

/**
 * Get the node position based on the placeholder node
 *
 * @param placeholderNode
 * @param newElement
 *
 * @returns obj: { posX, posY, handleX, handleY }
 */
export const getElementPositionBasedOnPlaceholderElement = (
  placeholderNode: Node,
  newElement: Node | string,
): {
  posX: number
  posY: number
  handleX: number
  handleY: number
} => {
  const newNodeStyle = getDefaultNodeStyle(
    typeof newElement === 'string' ? { nodeType: newElement } : { node: newElement },
  )

  const placeholderHandles = placeholderNode.data.handles as CustomHandleProps[]
  const placeholderHandle = placeholderHandles[0]

  const position = {
    posX: placeholderHandle.glbPosition.x + newNodeStyle.gap,
    posY: placeholderHandle.glbPosition.y - newNodeStyle.handle.y,
    handleX: placeholderHandle.glbPosition.x + newNodeStyle.gap,
    handleY: placeholderHandle.glbPosition.y,
  }

  return position
}

/**
 * Get the node position based on the previous node
 *
 * @param previousElement
 * @param newElement
 * @param type: 'serial' | 'parallel'
 *
 * @returns { posX, posY, handleX, handleY }
 */
export const getNodePositionBasedOnPreviousNode = (
  previousElement: Node,
  newElement: string | Node,
  type: 'serial' | 'parallel',
): {
  posX: number
  posY: number
  handleX: number
  handleY: number
} => {
  const previousElementOutputHandle = (
    type === 'parallel'
      ? (previousElement as ParallelNode).data.parallelOutputConnector
      : previousElement.data.outputConnector
  ) as CustomHandleProps
  const previousElementStyle = getDefaultNodeStyle({ node: previousElement })
  const newNodeStyle = getDefaultNodeStyle(
    typeof newElement === 'string' ? { nodeType: newElement } : { node: newElement },
  )

  const gap = previousElementStyle.gap + newNodeStyle.gap
  const offsetY = newNodeStyle.handle.y

  const position = {
    posX: previousElement.position.x + (previousElement.width || 0) + gap,
    posY:
      previousElement.type === (typeof newElement === 'string' ? newElement : newElement.type)
        ? previousElement.position.y
        : previousElementOutputHandle.glbPosition.y - offsetY,
    handleX: previousElement.position.x + (previousElement.width || 0) + gap,
    handleY: previousElementOutputHandle.glbPosition.y,
  }

  return position
}

/**
 * ========================
 * Parallel Utils Functions
 * ========================
 */

/**
 * Find all parallels in a rung
 *
 * @param rung
 *
 * @returns ParallelNode[]
 */
export const findParallelsInRung = (rung: RungLadderState): ParallelNode[] => {
  const parallels: Node[] = []
  let isAnotherParallel = true
  let parallel: ParallelNode | undefined = undefined
  rung.nodes.forEach((node) => {
    if (isAnotherParallel && node.type === 'parallel' && (node as ParallelNode).data.type === 'open') {
      parallels.push(node)
      parallel = node as ParallelNode
      isAnotherParallel = false
    }
    if (
      !isAnotherParallel &&
      node.type === 'parallel' &&
      (node as ParallelNode).data.type === 'close' &&
      parallel?.data.parallelCloseReference === node.id
    ) {
      isAnotherParallel = true
    }
  })
  return parallels as ParallelNode[]
}

/**
 * Find the deepest parallel inside a parallel connection
 *
 * @param rung
 * @param parallel - The parallel node
 *
 * @returns ParallelNode
 */
export const findDeepestParallelInsideParallel = (rung: RungLadderState, parallel: Node): ParallelNode => {
  const parallelIndex = rung.nodes.findIndex((node) => node.id === parallel.id)
  for (let i = parallelIndex; i < rung.nodes.length; i++) {
    const node = rung.nodes[i]
    if (node.type === 'parallel' && (node as ParallelNode).data.type === 'close') {
      return node as ParallelNode
    }
  }
  return parallel as ParallelNode
}

/**
 * Find all parallels depth and nodes of those parallels
 *
 * @param rung
 * @param openParallel - The open parallel node
 * @param depth - The depth of the parallel
 * @param parentNode - The parent node of the parallel
 *
 * @returns object: { [key: string]: { parent: ParallelNode | undefined, parallels: { open: ParallelNode, close: ParallelNode }, depth: number, height: number, highestNode: Node, nodes: { serial: Node[], parallel: Node[] } } }
 */
export const findAllParallelsDepthAndNodes = (
  rung: RungLadderState,
  openParallel: ParallelNode,
  depth: number = 0,
  parentNode: ParallelNode | undefined = undefined,
) => {
  let objectParallel: {
    [key: string]: {
      parent: ParallelNode | undefined
      parallels: {
        open: ParallelNode
        close: ParallelNode
      }
      depth: number
      height: number
      highestNode: Node
      nodes: {
        serial: Node[]
        parallel: Node[]
      }
    }
  } = {}

  const closeNode = rung.nodes.find((node) => node.id === openParallel.data.parallelCloseReference) as ParallelNode
  const nodesInsideParallel = getNodesInsideParallel(rung, closeNode)

  // check serial nodes
  const serialNodes = nodesInsideParallel.serial
  let highestNode = serialNodes[0]
  let serialHeight = highestNode.height ?? 0
  for (const serialNode of serialNodes) {
    // If it is a parallel node, check if it is an open parallel
    // If it is, call the function recursively
    if (serialNode.type === 'parallel') {
      const serialParallel = serialNode as ParallelNode
      if (serialParallel.data.type === 'open') {
        const object = findAllParallelsDepthAndNodes(rung, serialParallel, depth, openParallel)
        objectParallel = { ...objectParallel, ...object }
      }
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

  // check parallel nodes
  const parallelNodes = nodesInsideParallel.parallel
  for (const parallelNode of parallelNodes) {
    const parallel = parallelNode as ParallelNode
    if (parallel.data.type === 'open') {
      const object = findAllParallelsDepthAndNodes(rung, parallel, deepestDepth, openParallel)
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

/**
 * Get the deepest nodes inside all parallels
 *
 * @param rung
 *
 * @returns Node[]
 */
export const getDeepestNodesInsideParallels = (rung: RungLadderState): Node[] => {
  const parallels = findParallelsInRung(rung)
  const nodes: Node[] = []
  parallels.forEach((parallel) => {
    const deepestParallel = findDeepestParallelInsideParallel(rung, parallel)
    const { parallel: parallelNodes } = getNodesInsideParallel(rung, deepestParallel)
    nodes.push(...parallelNodes)
  })
  return nodes
}

/**
 * Get all nodes inside all parallels
 *
 * @param rung
 *
 * @returns Node[]
 */
export const getNodesInsideAllParallels = (rung: RungLadderState): Node[] => {
  const closeParallels = rung.nodes.filter(
    (node) => node.type === 'parallel' && (node as ParallelNode).data.type === 'close',
  )
  const nodes: Node[] = []
  closeParallels.forEach((closeParallel) => {
    const { serial, parallel: parallelNodes } = getNodesInsideParallel(rung, closeParallel)
    nodes.push(...serial, ...parallelNodes)
  })
  return nodes
}

/**
 * Get the nodes inside a parallel connection
 *
 * @param rung
 * @param closeParallelNode - The close parallel node
 *
 * @returns object: { serial: Node[], parallel: Node[] }
 */
export const getNodesInsideParallel = (
  rung: RungLadderState,
  closeParallelNode: Node,
): { serial: Node[]; parallel: Node[] } => {
  const openParallelNode = rung.nodes.find(
    (node) => node.id === closeParallelNode.data.parallelOpenReference,
  ) as ParallelNode
  const serial: Node[] = []
  const parallel: Node[] = []

  const openParallelEdges = rung.edges.filter((edge) => edge.source === openParallelNode.id)
  for (const parallelEdge of openParallelEdges) {
    let nextEdge = parallelEdge
    while (nextEdge && nextEdge.target !== closeParallelNode.id) {
      const node = rung.nodes.find((n) => n.id === nextEdge.target)
      if (!node) continue
      nextEdge = rung.edges.find(
        (edge) =>
          edge.source === nextEdge.target && edge.sourceHandle === (node.data as BasicNodeData).outputConnector?.id,
      ) as Edge
      // Serial
      if (parallelEdge.sourceHandle === openParallelNode.data.outputConnector?.id) serial.push(node)
      // Parallel
      else parallel.push(node)
    }
  }

  return { serial, parallel }
}

/**
 * ========================
 * Placeholder Utils Functions
 * ========================
 */

/**
 * Get the placeholder position based on the node
 *
 * @param node
 * @param side: 'left' | 'bottom' | 'right'
 *
 * @returns { posX, posY, handleX, handleY }
 */
export const getPlaceholderPositionBasedOnNode = (node: Node, side: 'left' | 'bottom' | 'right') => {
  switch (side) {
    case 'left':
      return {
        posX:
          node.position.x -
          getDefaultNodeStyle({ nodeType: 'placeholder' }).gap -
          getDefaultNodeStyle({ nodeType: 'placeholder' }).width / 2,
        posY:
          ((node.data.inputConnector ?? node.data.outputConnector) as CustomHandleProps)?.glbPosition.y -
          getDefaultNodeStyle({ nodeType: 'placeholder' }).handle.y,
        handleX:
          node.position.x -
          getDefaultNodeStyle({ nodeType: 'placeholder' }).gap -
          getDefaultNodeStyle({ nodeType: 'placeholder' }).width / 2,
        handleY: ((node.data.inputConnector ?? node.data.outputConnector) as CustomHandleProps)?.glbPosition.y,
      }
    case 'right':
      return {
        posX:
          node.position.x +
          (node.width || 0) +
          getDefaultNodeStyle({ nodeType: 'placeholder' }).gap -
          getDefaultNodeStyle({ nodeType: 'placeholder' }).width / 2,
        posY:
          ((node.data.outputConnector ?? node.data.inputConnector) as CustomHandleProps)?.glbPosition.y -
          getDefaultNodeStyle({ nodeType: 'placeholder' }).handle.y,
        handleX:
          node.position.x +
          (node.width || 0) +
          getDefaultNodeStyle({ nodeType: 'placeholder' }).gap -
          getDefaultNodeStyle({ nodeType: 'placeholder' }).width,
        handleY: ((node.data.outputConnector ?? node.data.inputConnector) as CustomHandleProps)?.glbPosition.y,
      }
    case 'bottom':
      return {
        posX: node.position.x + (node.width || 0) / 2 - getDefaultNodeStyle({ nodeType: 'placeholder' }).width / 2,
        posY:
          node.position.y +
          (node.height || 0) -
          getDefaultNodeStyle({ nodeType: 'parallelPlaceholder' }).handle.y +
          getDefaultNodeStyle({ nodeType: 'parallelPlaceholder' }).gap,
        handleX: node.position.x + (node.width || 0) / 2 - getDefaultNodeStyle({ nodeType: 'placeholder' }).width / 2,
        handleY:
          node.position.y +
          (node.height || 0) -
          getDefaultNodeStyle({ nodeType: 'parallelPlaceholder' }).handle.y +
          getDefaultNodeStyle({ nodeType: 'parallelPlaceholder' }).gap,
      }
  }
}
