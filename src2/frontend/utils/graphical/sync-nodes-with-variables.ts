import type { PLCVariable } from '../../../middleware/shared/ports/types'
import type { FBDFlowActions, FBDFlowState } from '../../store/slices/fbd/types'
import type { LadderFlowActions, LadderFlowState } from '../../store/slices/ladder/types'
import { FBD_VARIABLE_NODE_TYPES } from '../../components/_atoms/graphical-editor/fbd/utils/constants'
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
  editorName?: string,
) => {
  const flowsToSync = editorName ? ladderFlows.filter((flow) => flow.name === editorName) : ladderFlows

  flowsToSync.forEach((flow) =>
    flow.rungs.forEach((rung) =>
      rung.nodes.forEach((node) => {
        const nodeVar = (node.data as { variable?: PLCVariable }).variable

        if (!nodeVar) return

        const target = newVars.find((v) => v.name.toLowerCase() === nodeVar.name.toLowerCase())

        if (!target) {
          return
        }

        const isVariableNode = node.type === 'variable'

        if (isVariableNode) {
          const needsUpdate =
            nodeVar.name.toLowerCase() !== target.name.toLowerCase() ||
            (node.data as { wrongVariable?: boolean }).wrongVariable

          if (needsUpdate) {
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
          return
        }

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
                variable: target,
                wrongVariable: true,
              },
            },
          })

          return
        }

        const needsRefresh =
          nodeVar.id !== target.id ||
          nodeVar.name.toLowerCase() !== target.name.toLowerCase() ||
          nodeVar.type.value.toLowerCase() !== target.type.value.toLowerCase() ||
          (node.data as { wrongVariable?: boolean }).wrongVariable

        if (needsRefresh) {
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
  editorName?: string,
) => {
  const flowsToSync = editorName ? fbdFlows.filter((flow) => flow.name === editorName) : fbdFlows

  flowsToSync.forEach((flow) =>
    flow.rung.nodes.forEach((node) => {
      const nodeVar = (node.data as { variable?: PLCVariable }).variable

      if (!nodeVar) return

      const target = newVars.find((v) => v.name.toLowerCase() === nodeVar.name.toLowerCase())

      if (!target) {
        return
      }

      const isVariableNode = FBD_VARIABLE_NODE_TYPES.includes(node.type as (typeof FBD_VARIABLE_NODE_TYPES)[number])

      if (isVariableNode) {
        const needsUpdate =
          nodeVar.id !== target.id ||
          nodeVar.name.toLowerCase() !== target.name.toLowerCase() ||
          nodeVar.type.value.toLowerCase() !== target.type.value.toLowerCase() ||
          nodeVar.type.definition !== target.type.definition ||
          (node.data as { wrongVariable?: boolean }).wrongVariable

        if (needsUpdate) {
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
        return
      }

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
              variable: target,
              wrongVariable: true,
            },
          },
        })

        return
      }

      const needsRefresh = nodeVar !== target || (node.data as { wrongVariable?: boolean }).wrongVariable

      if (needsRefresh) {
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
