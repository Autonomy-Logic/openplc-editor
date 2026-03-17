import type { EditorModel, LadderFlowType } from '@root/renderer/store/slices'
import type { PLCPou } from '@root/types/PLC/open-plc'
import type { PLCVariable } from '@root/types/PLC/units/variable'
import { resolveArrayVariableByName } from '@root/utils/PLC/array-variable-utils'

import type { BasicNodeData } from './types'

export const getLadderPouVariablesRungNodeAndEdges = (
  editor: EditorModel,
  pous: PLCPou[],
  ladderFlows: LadderFlowType[],
  data: { nodeId: string; variableName?: string },
): {
  pou: PLCPou | undefined
  rung: LadderFlowType['rungs'][0] | undefined
  variables: { all: PLCVariable[]; selected: PLCVariable | undefined }
  edges: {
    source: LadderFlowType['rungs'][0]['edges'] | undefined
    target: LadderFlowType['rungs'][0]['edges'] | undefined
  }
  node: LadderFlowType['rungs'][0]['nodes'][0] | undefined
} => {
  const pou = pous.find((pou) => pou.data.name === editor.meta.name)

  const rung = ladderFlows
    .find((flow) => flow.name === editor.meta.name)
    ?.rungs.find((rung) => rung.nodes.some((node) => node.id === data.nodeId))

  const node = rung?.nodes.find((node) => node.id === data.nodeId)

  const variables: PLCVariable[] = pou?.data.variables as PLCVariable[]
  let variable = variables.find((variable) => {
    if (!node) return undefined
    switch (node.type) {
      case 'block':
        return (
          (node.data as BasicNodeData).variable.name !== undefined &&
          (node.data as BasicNodeData).variable.name.toLowerCase() === variable.name.toLowerCase()
        )
      case 'variable':
        // Variable nodes connected to block pins - allow all types including derived (user-defined types)
        return (node.data as BasicNodeData).variable.name !== undefined
          ? variable.name.toLowerCase() === (node.data as BasicNodeData).variable.name.toLowerCase()
          : variable.name === data.variableName
      default:
        // Contacts and coils - only allow base types (not derived/user-defined)
        return (
          ((node.data as BasicNodeData).variable.name !== undefined
            ? variable.name.toLowerCase() === (node.data as BasicNodeData).variable.name.toLowerCase()
            : variable.name === data.variableName) && variable.type.definition !== 'derived'
        )
    }
  })

  // Fallback: try to resolve as array element access (e.g. "Sensor[0]")
  if (!variable && node) {
    const varName = (node.data as BasicNodeData).variable.name || data.variableName
    if (varName) {
      const resolved = resolveArrayVariableByName(variables, varName)
      if (resolved && (node.type === 'block' || node.type === 'variable' || resolved.type.definition !== 'derived')) {
        variable = resolved
      }
    }
  }

  const edgesThatNodeIsSource = rung?.edges.filter((edge) => edge.source === data.nodeId)
  const edgesThatNodeIsTarget = rung?.edges.filter((edge) => edge.target === data.nodeId)

  return {
    pou,
    rung,
    variables: { all: variables, selected: variable },
    edges: { source: edgesThatNodeIsSource, target: edgesThatNodeIsTarget },
    node,
  }
}
