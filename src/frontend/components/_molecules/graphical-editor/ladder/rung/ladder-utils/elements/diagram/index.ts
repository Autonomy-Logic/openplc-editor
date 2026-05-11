// import type { VariableNode } from '../../../../../../../_atoms/graphical-editor/ladder/variable'
import type { RungLadderState } from '@root/frontend/store/slices'
import type { Edge, Node } from '@xyflow/react'
import { Position } from '@xyflow/react'

import { defaultCustomNodesStyles } from '../../../../../../../_atoms/graphical-editor/ladder/node-builders'
import type { BasicNodeData, ParallelNode } from '../../../../../../../_atoms/graphical-editor/ladder/utils/types'
import { getDefaultNodeStyle, isNodeOfType } from '../../nodes'
import {
  applyDynamicBlockHandleOffsets as applyDynamicBlockHandleOffsetsImpl,
  inflateBlockHeightsForBranches,
  maxBranchSpanWidth,
  positionBranchElements as positionBranchElementsImpl,
  updateRailForBranches as updateRailForBranchesImpl,
} from '../handle-branch'
import {
  findAllParallelsDepthAndNodes,
  findParallelsInRung,
  getNodePositionBasedOnPreviousNode,
  getPreviousElementsByEdge,
} from '../utils'
import { updateVariableBlockPosition } from '../variable-block'

/**
 * Uniform return shape for every layout pass — keeps the orchestrator
 * a simple `passes.reduce(...)` instead of bespoke wrappers per pass.
 */
type LayoutResult = { nodes: Node[]; edges: Edge[] }

/**
 * Change the right rail bounds based on the nodes position
 *
 * @param rightRail The right rail node
 * @param nodes The nodes in the rung
 * @param defaultBounds The default bounds of the rung
 *
 * @returns The new right rail node
 */
export const changeRailBounds = (rung: RungLadderState, defaultBounds: [number, number]): LayoutResult => {
  const rightRail = rung.nodes.find((node) => node.id.startsWith('right-rail'))
  if (!rightRail) return { nodes: rung.nodes, edges: rung.edges }

  const handles = rightRail.data.handles
  const railStyle = getDefaultNodeStyle({ node: rightRail })
  const nodesWithNoRail = rung.nodes.filter((node) => !node.id.startsWith('right-rail'))

  const flowXBounds = nodesWithNoRail.reduce(
    (acc, node) => {
      const nodeStyle = getDefaultNodeStyle({ node })
      return {
        minX: Math.min(acc.minX, node.position.x),
        maxX: Math.max(acc.maxX, node.position.x + (node.width || 0) + 2 * nodeStyle.gap + railStyle.gap),
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

    return { nodes: [...nodesWithNoRail, newRail], edges: rung.edges }
  }

  const newRail = {
    ...rightRail,
    position: { x: defaultBounds[0] - railStyle.width, y: rightRail.position.y },
    data: {
      ...rightRail.data,
      handles: handles.map((handle) => ({ ...handle, x: defaultBounds[0] - railStyle.width })),
    },
  }
  return { nodes: [...nodesWithNoRail, newRail], edges: rung.edges }
}

/**
 * Look up the OPEN parallel node whose parallel contains the given node id
 * (either as a serial step on a path, or as a parallel-path entry).
 * Returns the OPEN node from `parallelsDepth`, or undefined when the node
 * isn't inside any parallel.
 */
const findOwningOpenForNode = (
  parallelsDepth: ReturnType<typeof findAllParallelsDepthAndNodes>[],
  nodeId: string,
): Node | undefined => {
  for (const parallelMap of parallelsDepth) {
    for (const objectKey in parallelMap) {
      const objectParallel = parallelMap[objectKey]
      const inSerial = objectParallel.nodes.serial.some((n) => n.id === nodeId)
      const inParallel = objectParallel.nodes.parallel.some((n) => n.id === nodeId)
      if (inSerial || inParallel) return objectParallel.parallels.open
    }
  }
  return undefined
}

/**
 * Stage 1 of the layout pipeline. Walks every node in `rung.nodes` once,
 * computing its new position based on its serial / parallel predecessors and
 * its enclosing parallel (if any), and rewrites its handle positions.
 *
 * Returns `null` when a previous-element lookup fails — callers treat that as
 * a hard abort and leave the rung unchanged.
 */
const positionMainNodes = (rung: RungLadderState): { nodes: Node[]; edges: Edge[] } | null => {
  const { nodes } = rung
  const newNodes: Node[] = []

  /**
   * Find the parallels in the rung
   */
  const parallels = findParallelsInRung(rung)
  const parallelsDepth = parallels.map((parallel) => findAllParallelsDepthAndNodes(rung, parallel))

  /**
   * Iterate over the nodes and update their position
   */
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]

    /**
     * Nodes that are not moved in the diagram
     * These nodes are just added to the new nodes array
     */
    if (node.type === 'powerRail') {
      newNodes.push(node)
      continue
    }

    /**
     * Variable nodes are derived/transient — they are removed and regenerated
     * by `updateVariableBlockPosition` based on each block's `connectedVariables`.
     * Pass them through unmodified here so their edges have valid endpoints
     * when downstream passes (the variable-edge filter, in particular) run.
     */
    if (node.type === 'variable') {
      newNodes.push(node)
      continue
    }

    /**
     * Handle-branch elements (contacts / coils / parallels with a
     * `branchContext` marker) are positioned by `positionBranchElements`
     * against the block handle and rail branch handle they connect,
     * NOT by the main-rail predecessor walk. Pass them through unchanged.
     *
     * The narrow on `node.type` lets TypeScript discriminate the union to
     * just the three node types that can carry `branchContext`.
     */
    if ((node.type === 'contact' || node.type === 'coil' || node.type === 'parallel') && node.data.branchContext) {
      newNodes.push(node)
      continue
    }

    let newNodePosition: { posX: number; posY: number; handleX: number; handleY: number } = {
      posX: 0,
      posY: 0,
      handleX: 0,
      handleY: 0,
    }

    /**
     * Find the previous nodes and edges of the current node
     */
    const { nodes: previousNodes, edges: previousEdges } = getPreviousElementsByEdge(
      { ...rung, nodes: newNodes } as RungLadderState,
      node,
    )
    if (!previousNodes || !previousEdges) return null

    /**
     * Detect whether `prevNode` (the immediate predecessor we'll feed into
     * `getNodePositionBasedOnPreviousNode`) is itself the inner side of a
     * same-type parallel chain — i.e. its own predecessor on the spine is
     * another parallel of the same sub-type. When `node` is also a same-
     * type parallel, the call collapses onto prev's X instead of stacking
     * another clearance, so a 3-deep "add parallel" doesn't funnel the
     * spine 49px-per-level rightward.
     */
    const isSameTypeParallelOf = (n: Node | undefined, sub: 'open' | 'close'): boolean =>
      !!n && isNodeOfType(n, 'parallel') && n.data.type === sub
    const prevIsAlreadyNestedFor = (prev: Node): boolean => {
      if (!isNodeOfType(prev, 'parallel')) return false
      const prevSubType = prev.data.type
      const prevPrevEdges = rung.edges.filter((e) => e.target === prev.id)
      for (const e of prevPrevEdges) {
        const prevPrev = newNodes.find((n) => n.id === e.source)
        if (isSameTypeParallelOf(prevPrev, prevSubType)) return true
      }
      return false
    }

    if (previousNodes.all.length === 1) {
      /**
       * Nodes that only have one edge connecting to them
       */
      const previousNode = previousNodes.all[0]
      const prevAlreadyNested = prevIsAlreadyNestedFor(previousNode)
      if (
        isNodeOfType(previousNode, 'parallel') &&
        previousNode.data.type === 'open' &&
        previousEdges[0].sourceHandle === previousNode.data.parallelOutputConnector?.id
      ) {
        newNodePosition = getNodePositionBasedOnPreviousNode(previousNode, node, 'parallel', prevAlreadyNested)
      } else {
        newNodePosition = getNodePositionBasedOnPreviousNode(previousNode, node, 'serial', prevAlreadyNested)
      }
    } else {
      /**
       * Nodes that have multiple edges connecting to them
       * It means that the node is an closed parallel
       */
      const openParallel = newNodes.find((n) => n.id === (node as ParallelNode).data.parallelOpenReference)
      if (!openParallel) continue

      const openParallelPosition = getNodePositionBasedOnPreviousNode(openParallel, node, 'serial')

      /**
       * Find the highest position of the previous nodes
       * This is used to calculate the position of the new node
       */
      let acc = newNodePosition
      for (let j = 0; j < previousNodes.all.length; j++) {
        const previousNode = previousNodes.all[j]
        const prevAlreadyNested = prevIsAlreadyNestedFor(previousNode)
        const position = getNodePositionBasedOnPreviousNode(previousNode, node, 'serial', prevAlreadyNested)
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

    /**
     * Find the parallel that
     * the node is in and update the position
     */
    let foundInParallel: boolean = false
    parallelsDepth.forEach((parallel) => {
      for (const object in parallel) {
        const objectParallel = parallel[object]
        if (objectParallel.nodes.parallel.find((n) => n.id === node.id)) {
          foundInParallel = true
          // When the top path's tallest node carries handle branches, add
          // extra vertical gap before the next path so the branch's
          // contacts and the path-below's element have visible breathing
          // room (the verticalGap on its own only inserts a small margin
          // past the FB body).
          const baseVerticalGap = getDefaultNodeStyle({ node: objectParallel.highestNode }).verticalGap
          const highestNodeHasBranch = rung.handleBranches.some((b) => b.blockId === objectParallel.highestNode.id)
          const verticalGap = baseVerticalGap + (highestNodeHasBranch ? 80 : 0)
          const newPosY =
            objectParallel.highestNode.position.y +
            objectParallel.height +
            verticalGap -
            getDefaultNodeStyle({ node }).handle.y
          const newHandleY = objectParallel.highestNode.position.y + objectParallel.height + verticalGap
          newNodePosition = {
            ...newNodePosition,
            posY: newPosY,
            handleY: newHandleY,
          }
          break
        }
        if (objectParallel.nodes.serial.find((n) => n.id === node.id)) {
          foundInParallel = true
          break
        }
      }
    })

    /**
     * Ensure the FB sits far enough right that its input branch fits between
     * the FB and whatever lies to its left — the local branch rail and any
     * branch contacts have to clear:
     *
     *   - The main left rail (when the FB is the first block on the rung),
     *   - The FB's immediate predecessor (a contact, a CLOSE, the rail),
     *   - The FB's enclosing parallel's OWN OPEN (when the FB lives inside
     *     a parallel — the local rail must anchor PAST that OPEN's vertical
     *     wire, not over it).
     *
     * `inputShift` is the branch's full horizontal extent; pick the strictest
     * required X across every constraint and shift the FB if needed.
     */
    if (rung.handleBranches.length > 0 && node.type === 'block') {
      const inputShift = maxBranchSpanWidth(rung, node.id, 'input')
      if (inputShift > 0) {
        let requiredFbX = newNodePosition.posX

        const owningOpenStale = findOwningOpenForNode(parallelsDepth, node.id)
        const owningOpen = owningOpenStale
          ? (newNodes.find((n) => n.id === owningOpenStale.id) ?? owningOpenStale)
          : undefined
        if (owningOpen) {
          const openRight = owningOpen.position.x + (owningOpen.width ?? 0)
          requiredFbX = Math.max(requiredFbX, openRight + inputShift)
        }

        // Anchor against EVERY predecessor's right edge, not just parallel
        // CLOSEs. Without this, an FB at the start of the rung (predecessor
        // = main left rail) keeps its natural `block.gap`-derived X, which
        // is narrower than the branch span — so the local rail and the
        // first branch contact end up overlapping the main rail's column.
        for (const prev of previousNodes.all) {
          const prevFresh = newNodes.find((n) => n.id === prev.id) ?? prev
          const prevRight = prevFresh.position.x + (prevFresh.width ?? 0)
          requiredFbX = Math.max(requiredFbX, prevRight + inputShift)
        }

        if (newNodePosition.posX < requiredFbX) {
          const delta = requiredFbX - newNodePosition.posX
          newNodePosition = {
            ...newNodePosition,
            posX: newNodePosition.posX + delta,
            handleX: newNodePosition.handleX + delta,
          }
        }
      }
    }

    /**
     * Update the handles position
     * based on the new node position
     */
    const nodeData = node.data as BasicNodeData
    const newNodeHandlesInputPosition = nodeData.inputHandles.map((handle, index) => {
      return {
        ...handle,
        glbPosition: {
          x: handle.position === Position.Left ? newNodePosition.handleX : newNodePosition.handleX + (node.width ?? 0),
          y:
            node.type !== 'block'
              ? newNodePosition.handleY
              : newNodePosition.handleY + index * defaultCustomNodesStyles.block.handle.offsetY,
        },
      }
    })
    const newNodeHandlesOutputPosition = nodeData.outputHandles.map((handle, index) => {
      return {
        ...handle,
        glbPosition: {
          x: handle.position === Position.Left ? newNodePosition.handleX : newNodePosition.handleX + (node.width ?? 0),
          y:
            node.type !== 'block'
              ? newNodePosition.handleY
              : newNodePosition.handleY + index * defaultCustomNodesStyles.block.handle.offsetY,
        },
      }
    })
    const newNodeHandlesPosition = [...newNodeHandlesInputPosition, ...newNodeHandlesOutputPosition]

    /**
     * Create the new node
     * and add it to the new nodes array
     *
     * If the node is a parallel node
     * update the parallel handles
     *
     * If not, update the input and output handles
     */
    if (!isNodeOfType(node, 'parallel')) {
      const newNode: Node<BasicNodeData> = {
        ...node,
        position: { x: newNodePosition.posX, y: newNodePosition.posY },
        data: {
          ...node.data,
          ...nodeData,
          handles: newNodeHandlesPosition,
          inputHandles: newNodeHandlesInputPosition,
          outputHandles: newNodeHandlesOutputPosition,
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
      const parallelNode = node
      const newParallelNode: ParallelNode = {
        ...parallelNode,
        position: { x: newNodePosition.posX, y: newNodePosition.posY },
        data: {
          ...parallelNode.data,
          handles: newNodeHandlesPosition,
          inputHandles: newNodeHandlesInputPosition,
          outputHandles: newNodeHandlesOutputPosition,
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

    /**
     * If the node is in a parallel
     * update the parallel object
     * with the new node
     */
    if (foundInParallel) {
      const newNode = newNodes[newNodes.length - 1]
      const parallelsDepthCopy = parallelsDepth
      parallelsDepthCopy.forEach((parallel, index) => {
        for (const object in parallel) {
          const objectParallel = parallel[object]
          if (objectParallel.nodes.parallel.find((n) => n.id === node.id)) {
            const nodeIndex = objectParallel.nodes.parallel.findIndex((n) => n.id === node.id)
            parallelsDepth[index][object].nodes.parallel.splice(nodeIndex, 1, newNode)
          }
          if (objectParallel.nodes.serial.find((n) => n.id === node.id)) {
            const nodeIndex = objectParallel.nodes.serial.findIndex((n) => n.id === node.id)
            parallelsDepth[index][object].nodes.serial.splice(nodeIndex, 1, newNode)
          }
          if (objectParallel.highestNode.id === node.id) {
            parallelsDepth[index][object].highestNode = newNode
          }
          if (objectParallel.parallels.open.id === node.id) {
            parallelsDepth[index][object].parallels.open = newNode as ParallelNode
          }
          if (objectParallel.parallels.close.id === node.id) {
            parallelsDepth[index][object].parallels.close = newNode as ParallelNode
          }
        }
      })
    }
  }

  return { nodes: newNodes, edges: rung.edges }
}

/**
 * Pushes branched handles down so the rail-to-branch wire has a clear
 * horizontal path below any obstacle blocks at the same Y. The block's
 * height grows to accommodate. Activated for serial branches in this
 * commit; Phase 4 extends the same hook to handle parallels-in-branch
 * (where vertical room is needed for OR-paths instead of obstacle clearance).
 */
const applyDynamicBlockHandleOffsets = (rung: RungLadderState, _defaultBounds: [number, number]): LayoutResult =>
  applyDynamicBlockHandleOffsetsImpl(rung)

/**
 * Positions contact / coil nodes that hang off a block input or output handle
 * (handle branches). Activated in Phase 3.C.
 */
const positionBranchElements = (rung: RungLadderState, _defaultBounds: [number, number]): LayoutResult =>
  positionBranchElementsImpl(rung)

/**
 * Syncs the dynamic `branch_*` rail handles to the latest block handle Ys.
 * Activated in Phase 3.C — keeps the rail handle aligned with its block
 * handle when the block moves around (e.g. another element added on the
 * main rung shifts the block).
 */
const updateRailForBranches = (rung: RungLadderState, _defaultBounds: [number, number]): LayoutResult =>
  updateRailForBranchesImpl(rung)

type LayoutPass = (rung: RungLadderState, defaultBounds: [number, number]) => LayoutResult

const layoutPasses: LayoutPass[] = [
  applyDynamicBlockHandleOffsets,
  positionBranchElements,
  updateRailForBranches,
  changeRailBounds,
  updateVariableBlockPosition,
]

/**
 * Update the position of the diagram elements
 *
 * @param rung The current rung state
 * @param defaultBounds The default bounds of the rung
 *
 * @returns The new nodes
 */
export const updateDiagramElementsPosition = (rung: RungLadderState, defaultBounds: [number, number]): LayoutResult => {
  // Pre-pass: grow each branched block's height to enclose its branch's
  // vertical extent (rail + parallel paths). `positionMainNodes` reads
  // `node.height` to decide where parallel sibling paths land on Y, so this
  // has to run BEFORE main-rung positioning.
  const inflated = inflateBlockHeightsForBranches(rung)
  const rungWithInflatedHeights = { ...rung, nodes: inflated.nodes } as RungLadderState

  const positioned = positionMainNodes(rungWithInflatedHeights)
  if (!positioned) return { nodes: rung.nodes, edges: rung.edges }

  return layoutPasses.reduce<LayoutResult>(
    (acc, pass) => pass({ ...rung, ...acc } as RungLadderState, defaultBounds),
    positioned,
  )
}
