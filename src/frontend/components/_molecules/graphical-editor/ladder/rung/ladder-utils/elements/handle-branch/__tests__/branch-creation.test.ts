/**
 * Focused test for handle branch creation on block boolean inputs.
 * Verifies the left rail grows, the contact connects, and the block expands
 * when a contact is placed on a CTU block's R (BOOL) input handle.
 */
import type { Edge, Node } from '@xyflow/react'
import { describe, expect, it } from 'vitest'

import {
  defaultCustomNodesStyles,
  nodesBuilder,
} from '@root/frontend/components/_atoms/graphical-editor/ladder/node-builders'
import { DEFAULT_POWER_RAIL_HEIGHT } from '@root/frontend/components/_atoms/graphical-editor/ladder/utils/constants'
import type { BasicNodeData } from '@root/frontend/components/_atoms/graphical-editor/ladder/utils/types'
import type { RungLadderState } from '@root/frontend/store/slices'

import { updateDiagramElementsPosition } from '../../diagram'
import { replaceVariableWithBranch } from '..'
import { updateVariableBlockPosition } from '../../variable-block'

/** Build a rung with left-rail, contact, CTU block, coil, right-rail + variable nodes. */
function buildTestCTURung(): RungLadderState {
  const rungId = 'test-rung-abc'

  // Use proper node builders (rail IDs include rungId suffix, matching real app)
  const leftRail = nodesBuilder.powerRail({
    id: `left-rail-${rungId}`,
    posX: 0,
    posY: 12,
    connector: 'right',
    handleX: 3,
    handleY: 32,
  }) as Node

  const rightRail = nodesBuilder.powerRail({
    id: `right-rail-${rungId}`,
    posX: 800,
    posY: 12,
    connector: 'left',
    handleX: 800,
    handleY: 32,
  }) as Node

  const contact = nodesBuilder.contact({
    id: 'CONTACT_MAIN_1',
    posX: 80,
    posY: 24,
    handleX: 80,
    handleY: 36,
    variant: 'default',
  }) as Node

  const blockNode = nodesBuilder.block({
    id: 'CTU_BLOCK_1',
    posX: 200,
    posY: 0,
    handleX: 200,
    handleY: 36,
    variant: {
      name: 'CTU',
      type: 'function_block',
      extensible: false,
      variables: [
        { name: 'CU', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'R', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'PV', class: 'input', type: { definition: 'base-type', value: 'INT' } },
        { name: 'Q', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'CV', class: 'output', type: { definition: 'base-type', value: 'INT' } },
      ],
    },
  }) as Node

  const coil = nodesBuilder.coil({
    id: 'COIL_MAIN_1',
    posX: 600,
    posY: 24,
    handleX: 600,
    handleY: 36,
    variant: 'default',
  }) as Node

  const leftHandleId = (leftRail.data as BasicNodeData).outputConnector?.id ?? 'left-rail'
  const rightHandleId = (rightRail.data as BasicNodeData).inputConnector?.id ?? 'right-rail'

  const edges: Edge[] = [
    { id: 'e1', source: leftRail.id, target: contact.id, sourceHandle: leftHandleId, targetHandle: 'input' },
    { id: 'e2', source: contact.id, target: blockNode.id, sourceHandle: 'output', targetHandle: 'CU' },
    { id: 'e3', source: blockNode.id, target: coil.id, sourceHandle: 'Q', targetHandle: 'input' },
    { id: 'e4', source: coil.id, target: rightRail.id, sourceHandle: 'output', targetHandle: rightHandleId },
  ]

  const nodes = [leftRail, contact, blockNode, coil, rightRail]

  const rung: RungLadderState = {
    id: rungId,
    comment: '',
    defaultBounds: [900, 200],
    reactFlowViewport: [0, 0, 1],
    selectedNodes: [],
    nodes,
    edges,
  }

  // Add Variable nodes for non-rail block handles
  const { nodes: withVars, edges: withVarEdges } = updateVariableBlockPosition(rung)
  return { ...rung, nodes: withVars, edges: withVarEdges }
}

describe('Handle branch creation on CTU block R input', () => {
  it('should create branch handle on left rail when placing contact on R input', () => {
    const rung = buildTestCTURung()
    const leftRailId = rung.nodes.find((n) => n.id.startsWith('left-rail'))!.id

    // Verify initial state: left rail has 1 handle
    const leftRail = rung.nodes.find((n) => n.id === leftRailId)!
    const leftRailData = leftRail.data as BasicNodeData
    expect(leftRailData.handles).toHaveLength(1)

    // Find the R input handle position on the block
    const block = rung.nodes.find((n) => n.id === 'CTU_BLOCK_1')!
    const blockData = block.data as BasicNodeData
    const rHandle = blockData.inputHandles.find((h) => h.id === 'R')!
    expect(rHandle).toBeDefined()

    // Create a branch: place a contact on the R input
    const result = replaceVariableWithBranch(
      rung,
      {
        blockId: 'CTU_BLOCK_1',
        handleId: 'R',
        direction: 'input',
        handlePosition: { x: rHandle.glbPosition.x, y: rHandle.glbPosition.y },
      },
      'contact',
    )

    // Verify branch was created
    expect(result.handleBranches).toHaveLength(1)
    expect(result.handleBranches[0].blockId).toBe('CTU_BLOCK_1')
    expect(result.handleBranches[0].handleId).toBe('R')
    expect(result.handleBranches[0].nodeIds).toHaveLength(1)

    // Verify left rail now has 2 handles (original + branch)
    const updatedLeftRail = result.nodes.find((n) => n.id === leftRailId)!
    const updatedLeftRailData = updatedLeftRail.data as BasicNodeData
    expect(updatedLeftRailData.handles).toHaveLength(2)
    expect(updatedLeftRailData.handles.some((h) => h.id === 'branch_CTU_BLOCK_1_R')).toBe(true)

    // Verify edges: left-rail → contact → block[R]
    const contactId = result.handleBranches[0].nodeIds[0]
    const edgeToContact = result.edges.find(
      (e) => e.source === leftRailId && e.target === contactId && e.sourceHandle === 'branch_CTU_BLOCK_1_R',
    )
    expect(edgeToContact).toBeDefined()

    const edgeToBlock = result.edges.find(
      (e) => e.source === contactId && e.target === 'CTU_BLOCK_1' && e.targetHandle === 'R',
    )
    expect(edgeToBlock).toBeDefined()
  })

  it('should expand block and position branch after full layout pipeline', () => {
    const rung = buildTestCTURung()

    const block = rung.nodes.find((n) => n.id === 'CTU_BLOCK_1')!
    const blockData = block.data as BasicNodeData
    const rHandle = blockData.inputHandles.find((h) => h.id === 'R')!

    // Create branch
    const branchResult = replaceVariableWithBranch(
      rung,
      {
        blockId: 'CTU_BLOCK_1',
        handleId: 'R',
        direction: 'input',
        handlePosition: { x: rHandle.glbPosition.x, y: rHandle.glbPosition.y },
      },
      'contact',
    )

    // Run full layout with the branch
    const { nodes: layoutNodes } = updateDiagramElementsPosition(
      { ...rung, nodes: branchResult.nodes, edges: branchResult.edges, handleBranches: branchResult.handleBranches },
      rung.defaultBounds as [number, number],
    )

    // 1. Left rail has branch handle with relPosition.y > 0
    const finalLeftRail = layoutNodes.find((n: Node) => n.id.startsWith('left-rail'))!
    const finalLeftRailData = finalLeftRail.data as BasicNodeData
    const branchHandle = finalLeftRailData.handles.find((h) => h.id === 'branch_CTU_BLOCK_1_R')
    expect(branchHandle).toBeDefined()
    expect(branchHandle!.relPosition.y).toBeGreaterThan(0)

    // 2. Rail height would grow (PowerRail component uses maxRelY + DEFAULT_POWER_RAIL_HEIGHT/2)
    const maxRelY = Math.max(...finalLeftRailData.handles.map((h) => h.relPosition?.y ?? 0))
    expect(Math.max(DEFAULT_POWER_RAIL_HEIGHT, maxRelY + DEFAULT_POWER_RAIL_HEIGHT / 2)).toBeGreaterThan(
      DEFAULT_POWER_RAIL_HEIGHT,
    )

    // 3. Contact is positioned (not at 0,0)
    const contactId = branchResult.handleBranches[0].nodeIds[0]
    const finalContact = layoutNodes.find((n: Node) => n.id === contactId)!
    expect(finalContact.position.x).toBeGreaterThan(0)
    expect(finalContact.position.y).toBeGreaterThan(0)

    // 4. Block height was expanded
    const finalBlock = layoutNodes.find((n: Node) => n.id === 'CTU_BLOCK_1')!
    expect(finalBlock.height).toBeGreaterThan(defaultCustomNodesStyles.block.height)

    // 5. Right rail is past the block
    const finalRightRail = layoutNodes.find((n: Node) => n.id.startsWith('right-rail'))!
    expect(finalRightRail.position.x).toBeGreaterThan(finalBlock.position.x + (finalBlock.width ?? 0))
  })
})
