import type { EditorModel, FlowType } from '@root/renderer/store/slices'
import type { PLCPou } from '@root/types/PLC/open-plc'
import type { PLCVariable } from '@root/types/PLC/units/variable'

import { BasicNodeData } from './types'

export const getPouVariablesRungNodeAndEdges = (
  editor: EditorModel,
  pous: PLCPou[],
  flows: FlowType[],
  data: { nodeId: string; variableName?: string },
): {
  pou: PLCPou | undefined
  rung: FlowType['rungs'][0] | undefined
  variables: { all: PLCVariable[]; selected: PLCVariable | undefined }
  edges: { source: FlowType['rungs'][0]['edges'] | undefined; target: FlowType['rungs'][0]['edges'] | undefined }
  node: FlowType['rungs'][0]['nodes'][0] | undefined
} => {
  const pou = pous.find((pou) => pou.data.name === editor.meta.name)

  const rung = flows
    .find((flow) => flow.name === editor.meta.name)
    ?.rungs.find((rung) => rung.nodes.some((node) => node.id === data.nodeId))

  const node = rung?.nodes.find((node) => node.id === data.nodeId)

  const variables: PLCVariable[] = pou?.data.variables as PLCVariable[]
  const variable = variables.find((variable) => {
    if (!node) return undefined
    switch (node.type) {
      case 'block':
        return (
          (node.data as BasicNodeData).variable.id !== undefined &&
          (node.data as BasicNodeData).variable.id === variable.id
        )
      case 'variable':
        return variable.name === data.variableName && variable.type.definition !== 'derived'
      default:
        return (
          ((node.data as BasicNodeData).variable.id !== undefined
            ? variable.id === (node.data as BasicNodeData).variable.id
            : variable.name === data.variableName) && variable.type.definition !== 'derived'
        )
    }
  })

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