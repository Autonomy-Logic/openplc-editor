import type { EditorModel, FBDFlowType, LadderFlowType } from "@root/renderer/store/slices";
import type { PLCPou, PLCVariable } from "@root/types/PLC/open-plc";

import type { BasicNodeData } from "./types";

export const getFBDPouVariablesRungNodeAndEdges = (
  editor: EditorModel,
  pous: PLCPou[],
  fbdFlows: FBDFlowType[],
  data: { nodeId: string; variableName?: string },
): {
  pou: PLCPou | undefined
  rung: FBDFlowType['rung'] | undefined
  variables: { all: PLCVariable[]; selected: PLCVariable | undefined }
  edges: {
    source: LadderFlowType['rungs'][0]['edges'] | undefined
    target: LadderFlowType['rungs'][0]['edges'] | undefined
  }
  node: LadderFlowType['rungs'][0]['nodes'][0] | undefined
} => {
  const pou = pous.find((pou) => pou.data.name === editor.meta.name)
  const rung = fbdFlows.find((flow) => flow.name === editor.meta.name)?.rung
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
