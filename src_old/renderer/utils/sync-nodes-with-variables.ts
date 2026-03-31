import { FBDFlowActions, FBDFlowState, LadderFlowActions, LadderFlowState } from '@root/renderer/store/slices'
import type { PLCVariable } from '@root/types/PLC/open-plc'
import { Node } from '@xyflow/react'

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
  ladderFlows: LadderFlowState['ladderFlows'],
  updateNode: LadderFlowActions['updateNode'],
) => {
  ladderFlows.forEach((flow) =>
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
  fbdFlows: FBDFlowState['fbdFlows'],
  updateNode: FBDFlowActions['updateNode'],
) => {
  fbdFlows.forEach((flow) =>
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
