import { nodesBuilder } from '@root/renderer/components/_atoms/react-flow/custom-nodes'
import { ParallelNode } from '@root/renderer/components/_atoms/react-flow/custom-nodes/parallel'
import { PlaceholderNode } from '@root/renderer/components/_atoms/react-flow/custom-nodes/placeholder'
import { BasicNodeData } from '@root/renderer/components/_atoms/react-flow/custom-nodes/utils/types'
import { RungState } from '@root/renderer/store/slices'
import { Edge, Node } from '@xyflow/react'
import { toInteger } from 'lodash'
import { v4 as uuidv4 } from 'uuid'

import { buildEdge, connectNodes, removeEdge } from '../../edges'
import { buildGenericNode, isNodeOfType, removeNode } from '../../nodes'
import { removePlaceholderNodes } from '../index'
import { getNodePositionBasedOnPreviousNode, getPreviousElementsByEdges } from '../utils'

/**
 * Find all parallels in a rung
 *
 * @param rung
 *
 * @returns ParallelNode[]
 */
export const findParallelsInRung = (rung: RungState): ParallelNode[] => {
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
export const findDeepestParallelInsideParallel = (rung: RungState, parallel: Node): ParallelNode => {
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
  rung: RungState,
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
export const getDeepestNodesInsideParallels = (rung: RungState): Node[] => {
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
export const getNodesInsideAllParallels = (rung: RungState): Node[] => {
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
const getNodesInsideParallel = (rung: RungState, closeParallelNode: Node): { serial: Node[]; parallel: Node[] } => {
  const openParallelNode = rung.nodes.find(
    (node) => node.id === closeParallelNode.data.parallelOpenReference,
  ) as ParallelNode
  const serial: Node[] = []
  const parallel: Node[] = []

  const openParallelEdges = rung.edges.filter((edge) => edge.source === openParallelNode.id)
  for (const parallelEdge of openParallelEdges) {
    let nextEdge = parallelEdge
    while (nextEdge.target !== closeParallelNode.id) {
      const node = rung.nodes.find((n) => n.id === nextEdge.target)
      if (!node) continue
      nextEdge = rung.edges.find((edge) => edge.source === nextEdge.target) as Edge
      // Serial
      if (parallelEdge.sourceHandle === openParallelNode.data.outputConnector?.id) serial.push(node)
      // Parallel
      else parallel.push(node)
    }
  }

  return { serial, parallel }
}

/**
 * Remove empty parallel connections.
 * - If the parallel connection is empty, remove the parallel connection and reconnect the nodes turning the parallel connection into serial.
 * - If the serial connection is empty, remove the serial connection and reconnect the nodes turning the parallel connection into serial.
 * - If the parallel connection is not empty, reconnect the nodes turning the parallel connection into serial.
 *
 * @param rung
 *
 * @returns object: { nodes: Node[], edges: Edge[] }
 */
export const removeEmptyParallelConnections = (rung: RungState): { nodes: Node[]; edges: Edge[] } => {
  const { nodes, edges } = rung

  let newNodes = [...nodes]
  let newEdges = [...edges]

  nodes.forEach((node) => {
    if (node.type === 'parallel') {
      const parallelNode = node as ParallelNode
      // check if it is an open parallel
      if (parallelNode.data.type === 'close') {
        const closeParallel = parallelNode
        const openParallel = newNodes.find((n) => n.id === closeParallel.data.parallelOpenReference) as ParallelNode

        /**
         * Get the nodes inside the parallel connection
         */
        const { serial: serialNodes, parallel: parallelNodes } = getNodesInsideParallel(
          { ...rung, nodes: newNodes, edges: newEdges },
          closeParallel,
        )

        /**
         * Check if the serial connection is empty
         */
        if (serialNodes.length === 0) {
          const serialEdge = newEdges.find(
            (edge) => edge.source === openParallel.id && edge.sourceHandle === openParallel.data.outputConnector?.id,
          )
          if (!serialEdge) return { nodes: newNodes, edges: newEdges }
          newEdges = removeEdge(newEdges, serialEdge.id)

          const openParallelTarget = newEdges.find((edge) => edge.target === openParallel.id)
          const openParallelSource = newEdges.find((edge) => edge.source === openParallel.id)
          const closeParallelTarget = newEdges.find((edge) => edge.target === closeParallel.id)
          const closeParallelSource = newEdges.find((edge) => edge.source === closeParallel.id)

          if (!openParallelTarget || !openParallelSource || !closeParallelSource || !closeParallelTarget) return

          /**
           * Check if the parallel connection is not empty. If it is not, reconnect nodes turning the parallel connection into serial
           * If it is empty, remove the parallel connection
           */
          if (parallelNodes.length > 0) {
            newEdges = removeEdge(newEdges, openParallelSource.id)
            newEdges = removeEdge(newEdges, closeParallelTarget.id)
            newEdges.push(
              buildEdge(openParallelTarget.source, openParallelSource.target, {
                sourceHandle: openParallelTarget.sourceHandle ?? undefined,
                targetHandle: openParallelSource.targetHandle ?? undefined,
              }),
            )
            newEdges.push(
              buildEdge(closeParallelTarget.source, closeParallelSource.target, {
                sourceHandle: closeParallelTarget.sourceHandle ?? undefined,
                targetHandle: closeParallelSource.targetHandle ?? undefined,
              }),
            )
          }

          newEdges = removeEdge(newEdges, openParallelTarget.id)
          newEdges = removeEdge(newEdges, closeParallelSource.id)

          newNodes = removeNode({ ...rung, nodes: newNodes }, closeParallel.id)
          newNodes = removeNode({ ...rung, nodes: newNodes }, openParallel.id)

          return { nodes: newNodes, edges: newEdges }
        }

        /**
         * Check if the parallel connection is empty
         */
        if (parallelNodes.length === 0) {
          const parallelEdge = newEdges.find(
            (edge) =>
              edge.source === openParallel.id && edge.sourceHandle === openParallel.data.parallelOutputConnector?.id,
          )
          if (!parallelEdge) return { nodes: newNodes, edges: newEdges }
          newEdges = removeEdge(newEdges, parallelEdge.id)

          const openParallelTarget = newEdges.find((edge) => edge.target === openParallel.id)
          const openParallelSource = newEdges.find((edge) => edge.source === openParallel.id)
          const closeParallelTarget = newEdges.find((edge) => edge.target === closeParallel.id)
          const closeParallelSource = newEdges.find((edge) => edge.source === closeParallel.id)

          if (!openParallelTarget || !openParallelSource || !closeParallelSource || !closeParallelTarget) return

          /**
           * Set serial connection between the openParallel and closeParallel
           */
          if (openParallelSource.id === closeParallelTarget.id) {
            newEdges = removeEdge(newEdges, openParallelSource.id)
            newEdges.push(
              buildEdge(openParallelTarget.source, closeParallelSource.target, {
                sourceHandle: openParallelTarget.sourceHandle ?? undefined,
                targetHandle: closeParallelSource.targetHandle ?? undefined,
              }),
            )
          }
          /**
           * If have other nodes inside the serial connection, reconnect nodes
           */
          if (openParallelSource.id !== closeParallelTarget.id) {
            newEdges = removeEdge(newEdges, openParallelSource.id)
            newEdges = removeEdge(newEdges, closeParallelTarget.id)
            newEdges.push(
              buildEdge(openParallelTarget.source, openParallelSource.target, {
                sourceHandle: openParallelTarget.sourceHandle ?? undefined,
                targetHandle: openParallelSource.targetHandle ?? undefined,
              }),
            )
            newEdges.push(
              buildEdge(closeParallelTarget.source, closeParallelSource.target, {
                sourceHandle: closeParallelTarget.sourceHandle ?? undefined,
                targetHandle: closeParallelSource.targetHandle ?? undefined,
              }),
            )
          }

          newEdges = removeEdge(newEdges, openParallelTarget.id)
          newEdges = removeEdge(newEdges, closeParallelSource.id)

          newNodes = removeNode({ ...rung, nodes: newNodes }, closeParallel.id)
          newNodes = removeNode({ ...rung, nodes: newNodes }, openParallel.id)
        }
      }
    }
  })
  return { nodes: newNodes, edges: newEdges }
}

/**
 * Start a parallel connection. The node will be created based on the node type, so it is going to be a new "clean" node
 *
 * @param rung
 * @param node - The node to be inserted in the parallel connection
 *    @param node.newElementType - The type of the new node
 *    @param node.blockType - The block type of the new node
 * @param placeholder - The placeholder node that will be replaced by the new node
 *    @param placeholder.selectedPlaceholder - The placeholder node
 *    @param placeholder.selectedPlaceholderIndex - The index of the placeholder node
 *
 * @returns object: { nodes: Node[], edges: Edge[] }
 */

export const startParallelConnectionByNodeType = <T>(
  rung: RungState,
  node: { newElementType: string; blockType: T | undefined },
  placeholder: { selectedPlaceholder: Node; selectedPlaceholderIndex: string },
): { nodes: Node[]; edges: Edge[] } => {
  const { selectedPlaceholder, selectedPlaceholderIndex } = placeholder

  let newNodes = [...rung.nodes]
  let newEdges = [...rung.edges]

  // Get the node above the selected placeholder
  const aboveNode = selectedPlaceholder.data.relatedNode as Node
  if (!aboveNode) return { nodes: newNodes, edges: newEdges }
  // Get the edges of the above node
  const aboveNodeTargetEdge = newEdges.filter((edge) => edge.target === aboveNode.id)
  const aboveNodeSourceEdge = newEdges.filter((edge) => edge.source === aboveNode.id)

  // Build parallel open node based on the node that antecede the above node or the above node itself
  const openParallelPosition = getNodePositionBasedOnPreviousNode(
    newNodes.find((node) => node.id === aboveNodeTargetEdge[0].source) ?? aboveNode,
    'parallel',
    'serial',
  )
  const openParallelNode = buildGenericNode({
    nodeType: 'parallel',
    id: `PARALLEL_OPEN_${uuidv4()}`,
    ...openParallelPosition,
  }) as ParallelNode

  // Build new element node
  const newElementPosition = getNodePositionBasedOnPreviousNode(openParallelNode, node.newElementType, 'parallel')
  const newElement = buildGenericNode({
    nodeType: node.newElementType,
    blockType: node.blockType,
    id: `${node.newElementType.toUpperCase()}_${uuidv4()}`,
    ...newElementPosition,
  })

  // Build new above node keeping the old data
  const newAboveNodePosition = getNodePositionBasedOnPreviousNode(openParallelNode, aboveNode, 'serial')
  const buildedAboveNode = buildGenericNode({
    nodeType: aboveNode.type ?? '',
    blockType: aboveNode.data.variant,
    id: `${aboveNode.type?.toUpperCase()}_${uuidv4()}`,
    ...newAboveNodePosition,
  })
  const newAboveNode = {
    ...buildedAboveNode,
    position: { x: newAboveNodePosition.posX, y: newAboveNodePosition.posY },
    data: {
      ...aboveNode.data,
      handles: buildedAboveNode.data.handles,
      inputConnector: buildedAboveNode.data.inputConnector,
      outputConnector: buildedAboveNode.data.outputConnector,
    },
  }

  // Build parallel close node
  const closeParallelPositionSerial = getNodePositionBasedOnPreviousNode(newAboveNode, 'parallel', 'serial')
  const closeParallelPositionParallel = getNodePositionBasedOnPreviousNode(selectedPlaceholder, 'parallel', 'serial')
  const closeParallelNode = nodesBuilder.parallel({
    id: `PARALLEL_CLOSE_${uuidv4()}`,
    type: 'close',
    posX:
      closeParallelPositionSerial.posX > closeParallelPositionParallel.posX
        ? closeParallelPositionSerial.posX
        : closeParallelPositionParallel.posX,
    posY: closeParallelPositionSerial.posY,
    handleX:
      closeParallelPositionSerial.handleX > closeParallelPositionParallel.handleX
        ? closeParallelPositionSerial.handleX
        : closeParallelPositionParallel.handleX,
    handleY: closeParallelPositionSerial.handleY,
  })

  // Add reference to the open parallel node
  openParallelNode.data.parallelCloseReference = closeParallelNode.id
  closeParallelNode.data.parallelOpenReference = openParallelNode.id

  // get the related node
  const relatedNode = (selectedPlaceholder as PlaceholderNode).data.relatedNode as Node
  const { nodes: relatedNodePreviousNodes, edges: relatedNodePreviousEdges } = getPreviousElementsByEdges(
    { ...rung, nodes: newNodes },
    relatedNode,
  )
  if (!relatedNodePreviousNodes || !relatedNodePreviousEdges) return { nodes: newNodes, edges: newEdges }

  // Insert the new nodes
  // first insert the new nodes
  newNodes.splice(toInteger(selectedPlaceholderIndex), 1, openParallelNode, newAboveNode, newElement, closeParallelNode)
  // then remove the old above node
  newNodes = newNodes.filter((node) => node.id !== aboveNode.id)
  // finally remove the placeholder nodes
  newNodes = removePlaceholderNodes(newNodes)

  // Create the new edges
  // clear old edges of the above node
  newEdges = newEdges.filter((edge) => edge.source !== aboveNode.id && edge.target !== aboveNode.id)

  // serial connections
  newEdges = connectNodes(
    { ...rung, nodes: newNodes, edges: newEdges },
    aboveNodeTargetEdge[0].source,
    openParallelNode.id,
    relatedNodePreviousNodes.length > 0 &&
      isNodeOfType(relatedNodePreviousNodes[0], 'parallel') &&
      (relatedNodePreviousNodes[0] as ParallelNode).data.type === 'open' &&
      relatedNodePreviousEdges[0].sourceHandle ===
        (relatedNodePreviousNodes[0] as ParallelNode).data.parallelOutputConnector?.id
      ? 'parallel'
      : 'serial',
    {
      sourceHandle: aboveNodeTargetEdge[0].sourceHandle ?? undefined,
      targetHandle: openParallelNode.data.inputConnector?.id,
    },
  )
  newEdges = connectNodes(
    { ...rung, nodes: newNodes, edges: newEdges },
    openParallelNode.id,
    newAboveNode.id,
    'serial',
    {
      sourceHandle: openParallelNode.data.outputConnector?.id,
      targetHandle: newAboveNode.data.inputConnector?.id,
    },
  )
  newEdges = connectNodes(
    { ...rung, nodes: newNodes, edges: newEdges },
    newAboveNode.id,
    closeParallelNode.id,
    'serial',
    {
      sourceHandle: newAboveNode.data.outputConnector?.id,
      targetHandle: closeParallelNode.data.inputConnector?.id,
    },
  )
  newEdges = connectNodes(
    { ...rung, nodes: newNodes, edges: newEdges },
    closeParallelNode.id,
    aboveNodeSourceEdge[0].target,
    'serial',
    {
      sourceHandle: closeParallelNode.data.outputConnector?.id,
      targetHandle: aboveNodeSourceEdge[0].targetHandle ?? undefined,
    },
  )

  // parallel connections
  newEdges = connectNodes(
    { ...rung, nodes: newNodes, edges: newEdges },
    openParallelNode.id,
    newElement.id,
    'parallel',
    {
      sourceHandle: openParallelNode.data.parallelOutputConnector?.id,
      targetHandle: newElement.data.inputConnector?.id,
    },
  )
  newEdges = connectNodes(
    { ...rung, nodes: newNodes, edges: newEdges },
    newElement.id,
    closeParallelNode.id,
    'parallel',
    {
      sourceHandle: newElement.data.outputConnector?.id,
      targetHandle: closeParallelNode.data.parallelInputConnector?.id,
    },
  )

  return { nodes: newNodes, edges: newEdges }
}

/**
 * Start a parallel connection keeping the node. The node will be kept and the connection will be made with the selected placeholder
 *
 * @param rung
 * @param node - The node to be inserted in the parallel connection
 * @param placeholder - The placeholder node that will be replaced by the new node
 *    @param placeholder.selectedPlaceholder - The placeholder node
 *    @param placeholder.selectedPlaceholderIndex - The index of the placeholder node
 *
 * @returns object: { nodes: Node[], edges: Edge[] }
 */
export const startParallelConnectionKeepingTheNode = (
  rung: RungState,
  node: Node,
  placeholder: { selectedPlaceholder: Node; selectedPlaceholderIndex: string },
): { nodes: Node[]; edges: Edge[] } => {
  const { selectedPlaceholder, selectedPlaceholderIndex } = placeholder

  let newNodes = [...rung.nodes]
  let newEdges = [...rung.edges]

  // Get the node above the selected placeholder
  const aboveNode = selectedPlaceholder.data.relatedNode as Node
  if (!aboveNode) return { nodes: newNodes, edges: newEdges }
  // Get the edges of the above node
  const aboveNodeTargetEdge = newEdges.filter((edge) => edge.target === aboveNode.id)
  const aboveNodeSourceEdge = newEdges.filter((edge) => edge.source === aboveNode.id)

  // Build parallel open node based on the node that antecede the above node or the above node itself
  const openParallelPosition = getNodePositionBasedOnPreviousNode(
    newNodes.find((node) => node.id === aboveNodeTargetEdge[0].source) ?? aboveNode,
    'parallel',
    'serial',
  )
  const openParallelNode = buildGenericNode({
    nodeType: 'parallel',
    id: `PARALLEL_OPEN_${uuidv4()}`,
    ...openParallelPosition,
  }) as ParallelNode

  // Build new element node
  const newElement = node as Node<BasicNodeData>

  // Build new above node
  const newAboveNodePosition = getNodePositionBasedOnPreviousNode(openParallelNode, aboveNode, 'serial')
  const buildedAboveNode = buildGenericNode({
    nodeType: aboveNode.type ?? '',
    blockType: aboveNode.data.variant,
    id: `${aboveNode.type?.toUpperCase()}_${uuidv4()}`,
    ...newAboveNodePosition,
  })
  const newAboveNode = {
    ...buildedAboveNode,
    position: { x: newAboveNodePosition.posX, y: newAboveNodePosition.posY },
    data: {
      ...aboveNode.data,
      handles: buildedAboveNode.data.handles,
      inputConnector: buildedAboveNode.data.inputConnector,
      outputConnector: buildedAboveNode.data.outputConnector,
    },
  }

  // Build parallel close node
  const closeParallelPositionSerial = getNodePositionBasedOnPreviousNode(newAboveNode, 'parallel', 'serial')
  const closeParallelPositionParallel = getNodePositionBasedOnPreviousNode(selectedPlaceholder, 'parallel', 'serial')
  const closeParallelNode = nodesBuilder.parallel({
    id: `PARALLEL_CLOSE_${uuidv4()}`,
    type: 'close',
    posX:
      closeParallelPositionSerial.posX > closeParallelPositionParallel.posX
        ? closeParallelPositionSerial.posX
        : closeParallelPositionParallel.posX,
    posY: closeParallelPositionSerial.posY,
    handleX:
      closeParallelPositionSerial.handleX > closeParallelPositionParallel.handleX
        ? closeParallelPositionSerial.handleX
        : closeParallelPositionParallel.handleX,
    handleY: closeParallelPositionSerial.handleY,
  })

  // Add reference to the open parallel node
  openParallelNode.data.parallelCloseReference = closeParallelNode.id
  closeParallelNode.data.parallelOpenReference = openParallelNode.id

  // get the related node
  const relatedNode = (selectedPlaceholder as PlaceholderNode).data.relatedNode as Node
  const { nodes: relatedNodePreviousNodes, edges: relatedNodePreviousEdges } = getPreviousElementsByEdges(
    { ...rung, nodes: newNodes },
    relatedNode,
  )
  if (!relatedNodePreviousNodes || !relatedNodePreviousEdges) return { nodes: newNodes, edges: newEdges }

  // Insert the new nodes
  // first insert the new nodes
  newNodes.splice(toInteger(selectedPlaceholderIndex), 1, openParallelNode, newAboveNode, newElement, closeParallelNode)
  // then remove the old above node
  newNodes = newNodes.filter((node) => node.id !== aboveNode.id)
  // finally remove the placeholder nodes
  newNodes = removePlaceholderNodes(newNodes)

  // Create the new edges
  // clear old edges of the above node
  newEdges = newEdges.filter((edge) => edge.source !== aboveNode.id && edge.target !== aboveNode.id)

  // serial connections
  newEdges = connectNodes(
    { ...rung, nodes: newNodes, edges: newEdges },
    aboveNodeTargetEdge[0].source,
    openParallelNode.id,
    relatedNodePreviousNodes.length > 0 &&
      isNodeOfType(relatedNodePreviousNodes[0], 'parallel') &&
      (relatedNodePreviousNodes[0] as ParallelNode).data.type === 'open' &&
      relatedNodePreviousEdges[0].sourceHandle ===
        (relatedNodePreviousNodes[0] as ParallelNode).data.parallelOutputConnector?.id
      ? 'parallel'
      : 'serial',
    {
      sourceHandle: aboveNodeTargetEdge[0].sourceHandle ?? undefined,
      targetHandle: openParallelNode.data.inputConnector?.id,
    },
  )
  newEdges = connectNodes(
    { ...rung, nodes: newNodes, edges: newEdges },
    openParallelNode.id,
    newAboveNode.id,
    'serial',
    {
      sourceHandle: openParallelNode.data.outputConnector?.id,
      targetHandle: newAboveNode.data.inputConnector?.id,
    },
  )
  newEdges = connectNodes(
    { ...rung, nodes: newNodes, edges: newEdges },
    newAboveNode.id,
    closeParallelNode.id,
    'serial',
    {
      sourceHandle: newAboveNode.data.outputConnector?.id,
      targetHandle: closeParallelNode.data.inputConnector?.id,
    },
  )
  newEdges = connectNodes(
    { ...rung, nodes: newNodes, edges: newEdges },
    closeParallelNode.id,
    aboveNodeSourceEdge[0].target,
    'serial',
    {
      sourceHandle: closeParallelNode.data.outputConnector?.id,
      targetHandle: aboveNodeSourceEdge[0].targetHandle ?? undefined,
    },
  )

  // parallel connections
  newEdges = connectNodes(
    { ...rung, nodes: newNodes, edges: newEdges },
    openParallelNode.id,
    newElement.id,
    'parallel',
    {
      sourceHandle: openParallelNode.data.parallelOutputConnector?.id,
      targetHandle: newElement.data.inputConnector?.id,
    },
  )
  newEdges = connectNodes(
    { ...rung, nodes: newNodes, edges: newEdges },
    newElement.id,
    closeParallelNode.id,
    'parallel',
    {
      sourceHandle: newElement.data.outputConnector?.id,
      targetHandle: closeParallelNode.data.parallelInputConnector?.id,
    },
  )

  return { nodes: newNodes, edges: newEdges }
}
