import { Node } from '@xyflow/react'

import type { PLCVariable } from '../../../middleware/shared/ports/types'
import { validateVariableType } from '../PLC/validate-variable-type'

export type LadderNodeUpdate = {
  editorName: string
  rungId: string
  nodeId: string
  node: import('@xyflow/react').Node
}

export type FBDNodeUpdate = { editorName: string; nodeId: string; node: import('@xyflow/react').Node }

// Batched: called at most once per sync pass with every corrected node, so
// the store applies the whole pass as a single commit instead of one
// produce() write per mismatched node.
type UpdateLadderNodesFn = (updates: LadderNodeUpdate[]) => void

type UpdateFBDNodesFn = (updates: FBDNodeUpdate[]) => void

type LadderRung = { id: string; nodes: import('@xyflow/react').Node[] }
type LadderFlow = { name: string; rungs: LadderRung[] }
type FBDFlow = { name: string; rung: { nodes: import('@xyflow/react').Node[] } }

const getBlockExpectedType = (node: Node): string => {
  const variant = (node.data as { variant?: { name?: string } }).variant

  if (node.type === 'contact' || node.type === 'coil') {
    return 'BOOL'
  }

  // Variable-pin nodes (block-pin connectors): the expected type is the pin's
  // declared type, carried in data.block.variableType. Their `variant` is the
  // string 'input'/'output', so the generic variant branch below would yield
  // '' and validateVariableType(x, '') is always false — which used to flag
  // every LINKED pin as wrongVariable on each relink pass (project open,
  // drag-stop), swapping its payload for a broken one and dirtying the POU.
  if (node.type === 'variable') {
    const pinType = (node.data as { block?: { variableType?: { type?: { value?: string } } } }).block?.variableType
      ?.type?.value
    return typeof pinType === 'string' ? pinType.trim().toUpperCase() : ''
  }

  if (variant && typeof variant.name === 'string') {
    return variant.name.trim().toUpperCase()
  }

  return ''
}

// Delegate to the shared PLC validator so this re-sync path agrees with
// connection-time validation: it understands ANY/ANY_* generics and treats
// a POINTER TO <T> variable as compatible with the ULINT address word
// (e.g. ADR's output), instead of a naive string-equality compare.
const sameType = (firstType: string, secondType: string) =>
  validateVariableType(firstType.toString().trim(), secondType.toString().trim()).isValid

const getNodeCorrection = (node: Node, newVars: PLCVariable[]): { data: Node['data'] } | undefined => {
  const nodeVar = (node.data as { variable?: PLCVariable }).variable

  if (!nodeVar) return undefined

  const target = newVars.find((v) => v.name.toLowerCase() === nodeVar.name.toLowerCase())

  if (!target) return undefined

  const expectedType = getBlockExpectedType(node)

  // Unknown expectation — don't judge. sameType(x, '') is always false,
  // so flagging here would mark perfectly valid links as broken.
  if (!expectedType) return undefined

  const isTheSameType = sameType(target.type.value, expectedType)

  if (!isTheSameType) {
    return {
      data: {
        ...node.data,
        variable: { ...target, id: `broken-${node.id}` },
        wrongVariable: true,
      },
    }
  }

  if ((node.data as { wrongVariable?: PLCVariable }).wrongVariable) {
    return {
      data: {
        ...node.data,
        variable: target,
        wrongVariable: false,
      },
    }
  }

  return undefined
}

// `rungId` scopes an element-level edit (add/remove/drag-stop) to the rung it
// touched. Variable-table edits (rename/retype/delete) must NOT pass it — the
// full sweep is what auto-corrects stale bindings in the other rungs.
export const syncNodesWithVariables = (
  newVars: PLCVariable[],
  ladderFlows: LadderFlow[],
  updateNodes: UpdateLadderNodesFn,
  editorName?: string,
  rungId?: string,
) => {
  const flowsToSync = editorName ? ladderFlows.filter((flow) => flow.name === editorName) : ladderFlows
  const updates: LadderNodeUpdate[] = []

  flowsToSync.forEach((flow) => {
    const rungsToSync = rungId ? flow.rungs.filter((rung) => rung.id === rungId) : flow.rungs
    rungsToSync.forEach((rung) =>
      rung.nodes.forEach((node) => {
        const correction = getNodeCorrection(node, newVars)
        if (!correction) return

        updates.push({
          editorName: flow.name,
          rungId: rung.id,
          nodeId: node.id,
          node: { ...node, ...correction },
        })
      }),
    )
  })

  if (updates.length > 0) updateNodes(updates)
}

export const syncNodesWithVariablesFBD = (
  newVars: PLCVariable[],
  fbdFlows: FBDFlow[],
  updateNodes: UpdateFBDNodesFn,
  editorName?: string,
) => {
  const flowsToSync = editorName ? fbdFlows.filter((flow) => flow.name === editorName) : fbdFlows
  const updates: FBDNodeUpdate[] = []

  flowsToSync.forEach((flow) =>
    flow.rung.nodes.forEach((node) => {
      const correction = getNodeCorrection(node, newVars)
      if (!correction) return

      updates.push({
        editorName: flow.name,
        nodeId: node.id,
        node: { ...node, ...correction },
      })
    }),
  )

  if (updates.length > 0) updateNodes(updates)
}
