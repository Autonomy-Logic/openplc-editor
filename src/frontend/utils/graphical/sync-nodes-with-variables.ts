import { Node } from '@xyflow/react'

import type { PLCVariable } from '../../../middleware/shared/ports/types'

type UpdateLadderNodeFn = (params: {
  editorName: string
  rungId: string
  nodeId: string
  node: import('@xyflow/react').Node
}) => void

type UpdateFBDNodeFn = (params: { editorName: string; nodeId: string; node: import('@xyflow/react').Node }) => void

type LadderRung = { id: string; nodes: import('@xyflow/react').Node[] }
type LadderFlow = { name: string; rungs: LadderRung[] }
type FBDFlow = { name: string; rung: { nodes: import('@xyflow/react').Node[] } }

const getBlockExpectedType = (node: Node): string => {
  const variant = (node.data as { variant?: { name?: string } }).variant

  if (node.type === 'contact' || node.type === 'coil') {
    return 'BOOL'
  }

  if (variant && typeof variant.name === 'string') {
    return variant.name.trim().toUpperCase()
  }

  return ''
}

const sameType = (firstType: string, secondType: string) =>
  firstType.toString().trim().toLowerCase() === secondType.toString().trim().toLowerCase()

export const syncNodesWithVariables = (
  newVars: PLCVariable[],
  ladderFlows: LadderFlow[],
  updateNode: UpdateLadderNodeFn,
  editorName?: string,
) => {
  const flowsToSync = editorName ? ladderFlows.filter((flow) => flow.name === editorName) : ladderFlows

  flowsToSync.forEach((flow) =>
    flow.rungs.forEach((rung) =>
      rung.nodes.forEach((node) => {
        const nodeVar = (node.data as { variable?: PLCVariable }).variable

        if (!nodeVar) return

        const target = newVars.find((v) => v.name.toLowerCase() === nodeVar.name.toLowerCase())

        if (!target) return

        const expectedType = getBlockExpectedType(node)

        const isTheSameType = sameType(target.type.value, expectedType)

        if (!isTheSameType) {
          updateNode({
            editorName: flow.name,
            rungId: rung.id,
            nodeId: node.id,
            node: {
              ...node,
              data: {
                ...node.data,
                variable: { ...target, id: `broken-${node.id}` },
                wrongVariable: true,
              },
            },
          })

          return
        }

        if ((node.data as { wrongVariable?: PLCVariable }).wrongVariable) {
          updateNode({
            editorName: flow.name,
            rungId: rung.id,
            nodeId: node.id,
            node: {
              ...node,
              data: {
                ...node.data,
                variable: target,
                wrongVariable: false,
              },
            },
          })
        }
      }),
    ),
  )
}

export const syncNodesWithVariablesFBD = (
  newVars: PLCVariable[],
  fbdFlows: FBDFlow[],
  updateNode: UpdateFBDNodeFn,
  editorName?: string,
) => {
  const flowsToSync = editorName ? fbdFlows.filter((flow) => flow.name === editorName) : fbdFlows

  flowsToSync.forEach((flow) =>
    flow.rung.nodes.forEach((node) => {
      const nodeVar = (node.data as { variable?: PLCVariable }).variable

      if (!nodeVar) return

      const target = newVars.find((v) => v.name.toLowerCase() === nodeVar.name.toLowerCase())

      if (!target) return

      const expectedType = getBlockExpectedType(node)

      const isTheSameType = sameType(target.type.value, expectedType)

      if (!isTheSameType) {
        updateNode({
          editorName: flow.name,
          nodeId: node.id,
          node: {
            ...node,
            data: {
              ...node.data,
              variable: { ...target, id: `broken-${node.id}` },
              wrongVariable: true,
            },
          },
        })

        return
      }

      if ((node.data as { wrongVariable?: PLCVariable }).wrongVariable) {
        updateNode({
          editorName: flow.name,
          nodeId: node.id,
          node: {
            ...node,
            data: {
              ...node.data,
              variable: target,
              wrongVariable: false,
            },
          },
        })
      }
    }),
  )
}
