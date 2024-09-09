import { nodesBuilder } from '@root/renderer/components/_atoms/react-flow/custom-nodes'
import { ParallelNode } from '@root/renderer/components/_atoms/react-flow/custom-nodes/parallel'
import { PlaceholderNode } from '@root/renderer/components/_atoms/react-flow/custom-nodes/placeholder'
import { BasicNodeData } from '@root/renderer/components/_atoms/react-flow/custom-nodes/utils/types'
import type { FlowState } from '@root/renderer/store/slices'
import type { Edge, Node } from '@xyflow/react'
import { Position } from '@xyflow/react'
import { toInteger } from 'lodash'
import { v4 as uuidv4 } from 'uuid'

import type { CustomHandleProps } from '../../../_atoms/react-flow/custom-nodes/handle'
import { buildEdge, connectNodes, disconnectNodes, removeEdge } from './edges'
import { buildGenericNode, getNodeStyle, isNodeOfType, removeNode } from './nodes'

/**
 * Local utilitaries functions
 */
const getPreviousElement = (nodes: Node[], nodeIndex?: number) => {
  return nodes[(nodeIndex ?? nodes.length - 1) - 1]
}

const getPreviousElementsByEdges = (
  rung: FlowState,
  node: Node,
): { nodes: Node[] | undefined; edges: Edge[] | undefined } => {
  const edges = rung.edges.filter((edge) => edge.target === node.id)
  if (!edges) return { nodes: undefined, edges: undefined }
  const previousNodes = rung.nodes.filter((n) => edges.map((edge) => edge.source).includes(n.id))
  if (!previousNodes) return { nodes: undefined, edges: edges }
  return { nodes: previousNodes, edges: edges }
}

const getNodePositionBasedOnPreviousNode = (
  previousElement: Node,
  newElement: string | Node,
  type: 'serial' | 'parallel',
) => {
  const previousElementOutputHandle = (
    type === 'parallel'
      ? (previousElement as ParallelNode).data.parallelOutputConnector
      : previousElement.data.outputConnector
  ) as CustomHandleProps
  const previousElementStyle = getNodeStyle({ node: previousElement })
  const newNodeStyle = getNodeStyle(typeof newElement === 'string' ? { nodeType: newElement } : { node: newElement })

  const gap = previousElementStyle.gap + newNodeStyle.gap
  const offsetY = newNodeStyle.handle.y

  const position = {
    posX: previousElement.position.x + previousElementStyle.width + gap,
    posY:
      previousElement.type === (typeof newElement === 'string' ? newElement : newElement.type)
        ? previousElement.position.y
        : previousElementOutputHandle.glbPosition.y - offsetY,
    handleX: previousElement.position.x + previousElementStyle.width + gap,
    handleY: previousElementOutputHandle.glbPosition.y,
  }

  return position
}

const getNodePositionBasedOnPlaceholderNode = (placeholderNode: Node, newElType: string) => {
  const newNodeStyle = getNodeStyle({ nodeType: newElType })

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

const getPlaceholderPositionBasedOnNode = (node: Node, side: 'left' | 'bottom' | 'right') => {
  switch (side) {
    case 'left':
      return {
        posX:
          node.position.x -
          getNodeStyle({ nodeType: 'placeholder' }).gap -
          getNodeStyle({ nodeType: 'placeholder' }).width / 2,
        posY:
          ((node.data.inputConnector ?? node.data.outputConnector) as CustomHandleProps)?.glbPosition.y -
          getNodeStyle({ nodeType: 'placeholder' }).handle.y,
        handleX:
          node.position.x -
          getNodeStyle({ nodeType: 'placeholder' }).gap -
          getNodeStyle({ nodeType: 'placeholder' }).width / 2,
        handleY: ((node.data.inputConnector ?? node.data.outputConnector) as CustomHandleProps)?.glbPosition.y,
      }
    case 'right':
      return {
        posX:
          node.position.x +
          getNodeStyle({ node }).width +
          getNodeStyle({ nodeType: 'placeholder' }).gap -
          getNodeStyle({ nodeType: 'placeholder' }).width / 2,
        posY:
          ((node.data.outputConnector ?? node.data.inputConnector) as CustomHandleProps)?.glbPosition.y -
          getNodeStyle({ nodeType: 'placeholder' }).handle.y,
        handleX:
          node.position.x +
          getNodeStyle({ node }).width +
          getNodeStyle({ nodeType: 'placeholder' }).gap -
          getNodeStyle({ nodeType: 'placeholder' }).width,
        handleY: ((node.data.outputConnector ?? node.data.inputConnector) as CustomHandleProps)?.glbPosition.y,
      }
    case 'bottom':
      return {
        posX: node.position.x + getNodeStyle({ node }).width / 2 - getNodeStyle({ nodeType: 'placeholder' }).width / 2,
        posY:
          node.position.y +
          (node?.height ?? 0) -
          getNodeStyle({ nodeType: 'parallelPlaceholder' }).handle.y +
          getNodeStyle({ nodeType: 'parallelPlaceholder' }).gap,
        handleX:
          node.position.x + getNodeStyle({ node }).width / 2 - getNodeStyle({ nodeType: 'placeholder' }).width / 2,
        handleY:
          node.position.y +
          (node?.height ?? 0) -
          getNodeStyle({ nodeType: 'parallelPlaceholder' }).handle.y +
          getNodeStyle({ nodeType: 'parallelPlaceholder' }).gap,
      }
  }
}

const changeRailBounds = (rightRail: Node, nodes: Node[], defaultBounds: [number, number]) => {
  const handles = rightRail.data.handles as CustomHandleProps[]
  const railStyle = getNodeStyle({ node: rightRail })
  const nodesWithNoRail = nodes.filter((node) => node.id !== 'right-rail')

  const flowXBounds = nodesWithNoRail.reduce(
    (acc, node) => {
      const nodeStyle = getNodeStyle({ node })
      return {
        minX: Math.min(acc.minX, node.position.x),
        maxX: Math.max(acc.maxX, node.position.x + nodeStyle.width + 2 * nodeStyle.gap + railStyle.gap),
      }
    },
    { minX: 0, maxX: 0 },
  )

  if (flowXBounds.maxX > defaultBounds[0]) {
    const newRail = {
      ...rightRail,
      position: {
        x: flowXBounds.maxX,
        y: rightRail.position.y,
      },
      data: {
        ...rightRail.data,
        handles: handles.map((handle) => ({
          ...handle,
          x: flowXBounds.maxX,
        })),
      },
    }
    return newRail
  }

  const newRail = {
    ...rightRail,
    position: { x: defaultBounds[0] - railStyle.width, y: rightRail.position.y },
    data: {
      ...rightRail.data,
      handles: handles.map((handle) => ({ ...handle, x: defaultBounds[0] - railStyle.width })),
    },
  }
  return newRail
}

const rearrangeNodes = (rung: FlowState, defaultBounds: [number, number]) => {
  const { nodes } = rung
  const newNodes: Node[] = []

  const parallels = findParallelsInRung(rung)
  const parallelsDepth = parallels.map((parallel) => findAllParallelsDepthAndNodes(rung, parallel))

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    if (node.type === 'powerRail') {
      newNodes.push(node)
      continue
    }

    const { nodes: previousNodes, edges: previousEdges } = getPreviousElementsByEdges(
      { ...rung, nodes: newNodes },
      node,
    )
    if (!previousNodes || !previousEdges) return nodes

    let newNodePosition: { posX: number; posY: number; handleX: number; handleY: number } = {
      posX: 0,
      posY: 0,
      handleX: 0,
      handleY: 0,
    }

    if (previousNodes.length === 1) {
      /**
       * Nodes that only have one edge connecting to them
       */
      const previousNode = previousNodes[0]

      if (
        isNodeOfType(previousNode, 'parallel') &&
        (previousNode as ParallelNode).data.type === 'open' &&
        previousEdges[0].sourceHandle === (previousNode as ParallelNode).data.parallelOutputConnector?.id
      ) {
        newNodePosition = getNodePositionBasedOnPreviousNode(previousNode, node, 'parallel')
      } else {
        newNodePosition = getNodePositionBasedOnPreviousNode(previousNode, node, 'serial')
      }
    } else {
      /**
       * Nodes that have multiple edges connecting to them
       */
      const openParallel = newNodes.find((n) => n.id === (node as ParallelNode).data.parallelOpenReference) as Node
      const openParallelPosition = getNodePositionBasedOnPreviousNode(openParallel, node, 'serial')

      let acc = newNodePosition
      for (let j = 0; j < previousNodes.length; j++) {
        const previousNode = previousNodes[j]
        const position = getNodePositionBasedOnPreviousNode(previousNode, node, 'serial')
        acc = {
          posX: Math.max(acc.posX, position.posX),
          posY: Math.max(acc.posY, position.posY),
          handleX: Math.max(acc.handleX, position.handleX),
          handleY: Math.max(acc.handleY, position.handleY),
        }
      }
      newNodePosition = {
        posX: acc.posX,
        posY: openParallelPosition.posY,
        handleX: acc.handleX,
        handleY: openParallelPosition.handleY,
      }
    }

    parallelsDepth.forEach((parallel) => {
      for (const object in parallel) {
        const objectParallel = parallel[object]
        if (objectParallel.nodes.parallel.find((n) => n.id === node.id)) {
          const newPosY =
            objectParallel.heighestNode.position.y +
            objectParallel.height +
            getNodeStyle({ node: objectParallel.heighestNode }).verticalGap -
            getNodeStyle({ node }).handle.y
          const newHandleY =
            objectParallel.heighestNode.position.y +
            objectParallel.height +
            getNodeStyle({ node: objectParallel.heighestNode }).verticalGap
          newNodePosition = {
            ...newNodePosition,
            posY: newPosY,
            handleY: newHandleY,
          }
        }
      }
    })

    const nodeData = node.data as BasicNodeData
    const newNodeHandlesPosition = nodeData.handles.map((handle) => {
      return {
        ...handle,
        glbPosition: {
          x: handle.position === Position.Left ? newNodePosition.handleX : newNodePosition.handleX + (node.width ?? 0),
          y: newNodePosition.handleY,
        },
      }
    })

    if (!isNodeOfType(node, 'parallel')) {
      const newNode: Node<BasicNodeData> = {
        ...node,
        position: { x: newNodePosition.posX, y: newNodePosition.posY },
        data: {
          ...nodeData,
          handles: newNodeHandlesPosition,
          inputConnector: newNodeHandlesPosition.find(
            (handle) => handle.id === (node.data as BasicNodeData).inputConnector?.id,
          ),
          outputConnector: newNodeHandlesPosition.find(
            (handle) => handle.id === (node.data as BasicNodeData).outputConnector?.id,
          ),
        },
      }
      newNodes.push(newNode)
    } else {
      const parallelNode = node as ParallelNode
      const newParallelNode: ParallelNode = {
        ...parallelNode,
        position: { x: newNodePosition.posX, y: newNodePosition.posY },
        data: {
          ...parallelNode.data,
          handles: newNodeHandlesPosition,
          inputConnector: newNodeHandlesPosition.find((handle) => handle.id === parallelNode.data.inputConnector?.id),
          outputConnector: newNodeHandlesPosition.find((handle) => handle.id === parallelNode.data.outputConnector?.id),
          parallelInputConnector: newNodeHandlesPosition.find(
            (handle) => handle.id === parallelNode.data.parallelInputConnector?.id,
          ),
          parallelOutputConnector: newNodeHandlesPosition.find(
            (handle) => handle.id === parallelNode.data.parallelOutputConnector?.id,
          ),
        },
      }
      newNodes.push(newParallelNode)
    }
  }

  newNodes[newNodes.length - 1] = changeRailBounds(newNodes[newNodes.length - 1], newNodes, defaultBounds)
  return newNodes
}
/**
 * Parallel functions
 */
const findParallelsInRung = (rung: FlowState) => {
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

const findDeepestParallelInsideParallel = (rung: FlowState, parallel: Node) => {
  const parallelIndex = rung.nodes.findIndex((node) => node.id === parallel.id)
  for (let i = parallelIndex; i < rung.nodes.length; i++) {
    const node = rung.nodes[i]
    if (node.type === 'parallel' && (node as ParallelNode).data.type === 'close') {
      return node as ParallelNode
    }
  }
  return parallel as ParallelNode
}

const findAllParallelsDepthAndNodes = (
  rung: FlowState,
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
      heighestNode: Node
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
  let serialHeight = 0
  let heighestNode = serialNodes[0]
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
    serialHeight = Math.max(serialHeight, serialNode.height ?? 0)
    if (serialHeight < (serialNode.height ?? 0)) {
      serialHeight = serialNode.height ?? 0
      heighestNode = serialNode
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
    heighestNode,
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

// const determineParallelHeight = (rung: FlowState, parallels: ParallelNode) => {}

const getDeepestNodesInsideParallels = (rung: FlowState) => {
  const parallels = findParallelsInRung(rung)
  const nodes: Node[] = []
  parallels.forEach((parallel) => {
    const deepestParallel = findDeepestParallelInsideParallel(rung, parallel)
    const { parallel: parallelNodes } = getNodesInsideParallel(rung, deepestParallel)
    nodes.push(...parallelNodes)
  })
  return nodes
}

const getNodesInsideAllParallels = (rung: FlowState) => {
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

const getNodesInsideParallel = (rung: FlowState, closeParallelNode: Node) => {
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

const removeEmptyParallelConnections = (rung: FlowState) => {
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

const startParallelConnection = (
  rung: FlowState,
  newElementType: string,
  placeholder: { selectedPlaceholder: Node; selectedPlaceholderIndex: string },
) => {
  const { selectedPlaceholder, selectedPlaceholderIndex } = placeholder

  let newNodes = [...rung.nodes]
  let newEdges = [...rung.edges]

  // Get the node above the selected placeholder
  const aboveNode = rung.nodes.find(
    (node) => node.id === getPreviousElement(rung.nodes, toInteger(selectedPlaceholderIndex)).id,
  )
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
  const newElementPosition = getNodePositionBasedOnPreviousNode(openParallelNode, newElementType, 'parallel')
  const newElement = buildGenericNode({
    nodeType: newElementType,
    id: `${newElementType.toUpperCase()}_${uuidv4()}`,
    ...newElementPosition,
  })

  // Build new above node
  const newAboveNodePosition = getNodePositionBasedOnPreviousNode(openParallelNode, aboveNode, 'serial')
  const newAboveNode = buildGenericNode({
    nodeType: aboveNode.type ?? '',
    id: `${aboveNode.type?.toUpperCase()}_${uuidv4()}`,
    ...newAboveNodePosition,
  })

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
 * Exported functions to control the rung elements
 */
export const addNewElement = (
  rung: FlowState,
  newElementType: string,
  defaultViewportBounds: [number, number],
): { nodes: Node[]; edges: Edge[] } => {
  const [selectedPlaceholderIndex, selectedPlaceholder] =
    Object.entries(rung.nodes).find(
      (node) => (node[1].type === 'placeholder' || node[1].type === 'parallelPlaceholder') && node[1].selected,
    ) ?? []
  if (!selectedPlaceholder || !selectedPlaceholderIndex) return { nodes: rung.nodes, edges: rung.edges }

  let newNodes = [...rung.nodes]
  let newEdges = [...rung.edges]
  if (isNodeOfType(selectedPlaceholder, 'parallelPlaceholder')) {
    const { nodes: parallelNodes, edges: parallelEdges } = startParallelConnection(rung, newElementType, {
      selectedPlaceholder,
      selectedPlaceholderIndex,
    })
    newEdges = parallelEdges
    newNodes = parallelNodes
  } else {
    const newElelementPosition = getNodePositionBasedOnPlaceholderNode(selectedPlaceholder, newElementType)
    const newElement = buildGenericNode({
      nodeType: newElementType,
      id: `${newElementType.toUpperCase()}_${uuidv4()}`,
      ...newElelementPosition,
    })
    newNodes.splice(toInteger(selectedPlaceholderIndex), 1, newElement)
    newNodes = removePlaceholderNodes(newNodes)

    // get the related node
    const relatedNode = (selectedPlaceholder as PlaceholderNode).data.relatedNode as Node
    const { nodes: relatedNodePreviousNodes, edges: relatedNodePreviousEdges } = getPreviousElementsByEdges(
      { ...rung, nodes: newNodes },
      relatedNode,
    )
    if (!relatedNodePreviousNodes || !relatedNodePreviousEdges) return { nodes: newNodes, edges: newEdges }

    // find the previous node
    let previousNode: Node = getPreviousElement(
      newNodes,
      newNodes.findIndex((n) => n.id === newElement.id),
    )
    // if the related node is a parallel, check if it is an open or close parallel
    if (
      relatedNodePreviousNodes.length > 0 &&
      isNodeOfType(relatedNodePreviousNodes[0], 'parallel') &&
      (relatedNodePreviousNodes[0] as ParallelNode).data.type === 'open' &&
      selectedPlaceholder.data.position === 'left' &&
      relatedNodePreviousEdges[0].sourceHandle ===
        (relatedNodePreviousNodes[0] as ParallelNode).data.parallelOutputConnector?.id
    ) {
      previousNode = relatedNodePreviousNodes[0]
      newEdges = connectNodes({ ...rung, nodes: newNodes }, previousNode.id, newElement.id, 'parallel')
    } else {
      newEdges = connectNodes({ ...rung, nodes: newNodes }, previousNode.id, newElement.id, 'serial')
    }
  }

  newNodes = rearrangeNodes({ ...rung, nodes: newNodes, edges: newEdges }, defaultViewportBounds)

  return { nodes: newNodes, edges: newEdges }
}

export const removeElement = (rung: FlowState, element: Node, defaultViewportBounds: [number, number]) => {
  const rails = rung.nodes.filter((node) => node.type === 'powerRail')
  const nodes = rung.nodes.filter((node) => node.type !== 'powerRail')

  let newNodes = nodes.filter((n) => n.id !== element.id)
  const newRails = changeRailBounds(rails[1], [rails[0], ...newNodes], defaultViewportBounds)

  newNodes = [rails[0], ...newNodes, newRails]

  const edge = rung.edges.find((edge) => edge.source === element.id)
  if (!edge) return { nodes: newNodes, edges: rung.edges }
  let newEdges = disconnectNodes(rung, edge.source, edge.target)

  const { nodes: auxNodes, edges: auxEdges } = removeEmptyParallelConnections({
    ...rung,
    nodes: newNodes,
    edges: newEdges,
  })
  newNodes = auxNodes
  newEdges = auxEdges

  return {
    nodes: newNodes,
    edges: newEdges,
  }
}

export const removeElements = (
  rungLocal: FlowState,
  nodes: Node[],
  defaultBounds: [number, number],
): { nodes: Node[]; edges: Edge[] } => {
  if (!nodes) return { nodes: rungLocal.nodes, edges: rungLocal.edges }
  const rungState = rungLocal

  for (const node of nodes) {
    const { nodes: newNodes, edges: newEdges } = removeElement(rungState, node, defaultBounds)
    rungState.nodes = newNodes
    rungState.edges = newEdges
  }

  rungState.nodes = rearrangeNodes(rungState, defaultBounds)

  return { nodes: rungState.nodes, edges: rungState.edges }
}

export const renderPlaceholderNodes = (rung: FlowState): Node[] => {
  const { nodes } = rung
  const placeholderNodes: Node[] = []
  const nodesInsideParallels = getNodesInsideAllParallels(rung)
  const deepestNodesParallels = getDeepestNodesInsideParallels(rung)

  nodes.forEach((node) => {
    let placeholders: Node[] = []
    if (node.type === 'placeholder' || node.type === 'parallelPlaceholder') {
      return
    }

    if (node.id === 'left-rail') {
      placeholders = [
        nodesBuilder.placeholder({
          id: `placeholder_${node.id}_${uuidv4()}`,
          type: 'default',
          relatedNode: node,
          position: 'right',
          ...getPlaceholderPositionBasedOnNode(node, 'right'),
        }),
      ]
      placeholderNodes.push(node, placeholders[0])
      return
    }

    if (node.id === 'right-rail') {
      placeholders = [
        nodesBuilder.placeholder({
          id: `placeholder_${node.id}_${uuidv4()}`,
          type: 'default',
          relatedNode: node,
          position: 'left',
          ...getPlaceholderPositionBasedOnNode(node, 'left'),
        }),
      ]
      placeholderNodes.push(placeholders[0], node)
      return
    }

    if (node.type === 'parallel') {
      if (node.data.type === 'open') {
        placeholders = [
          nodesBuilder.placeholder({
            id: `placeholder_${node.id}_${uuidv4()}`,
            type: 'default',
            relatedNode: node,
            position: 'left',
            ...getPlaceholderPositionBasedOnNode(node, 'left'),
          }),
        ]
        placeholderNodes.push(placeholders[0], node)
        return
      }
      placeholders = [
        nodesBuilder.placeholder({
          id: `placeholder_${node.id}_${uuidv4()}`,
          type: 'default',
          relatedNode: node,
          position: 'right',
          ...getPlaceholderPositionBasedOnNode(node, 'right'),
        }),
      ]
      placeholderNodes.push(node, placeholders[0])

      return
    }

    placeholders = [
      nodesBuilder.placeholder({
        id: `placeholder_${node.id}_${uuidv4()}`,
        type: 'default',
        relatedNode: node,
        position: 'left',
        ...getPlaceholderPositionBasedOnNode(node, 'left'),
      }),
      nodesBuilder.placeholder({
        id: `placeholder_${node.id}_${uuidv4()}`,
        type: 'default',
        relatedNode: node,
        position: 'right',
        ...getPlaceholderPositionBasedOnNode(node, 'right'),
      }),
    ]

    if (!nodesInsideParallels.includes(node) || deepestNodesParallels.includes(node)) {
      placeholders.push(
        nodesBuilder.placeholder({
          id: `parallelPlaceholder_${node.id}_${uuidv4()}`,
          type: 'parallel',
          relatedNode: node,
          position: 'bottom',
          ...getPlaceholderPositionBasedOnNode(node, 'bottom'),
        }),
      )
      placeholderNodes.push(placeholders[0], node, placeholders[2], placeholders[1])
      return placeholderNodes
    }

    placeholderNodes.push(placeholders[0], node, placeholders[1])
  })
  return placeholderNodes
}

export const removePlaceholderNodes = (nodes: Node[]): Node[] => {
  const nodesNoPlaceholder = nodes.filter((node) => node.type !== 'placeholder' && node.type !== 'parallelPlaceholder')
  return nodesNoPlaceholder
}
