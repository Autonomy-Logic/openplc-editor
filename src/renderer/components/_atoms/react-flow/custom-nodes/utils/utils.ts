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
  const variable = variables.find((variable) =>
    // Check if the node exists
    !node
      ? undefined
      : // Check if the node is a block
        node?.type === 'block'
        ? // If it is a block, check if the variable id is the same as the node variable id
          (node.data as BasicNodeData).variable.id !== undefined &&
          variable.id === (node.data as BasicNodeData).variable.id
        : // If it is not a block, check if the block is synced with a variable
          (node.data as BasicNodeData).variable.id !== undefined
          // Get the variable by the variable id
          ? variable.id === (node.data as BasicNodeData).variable.id && variable.type.definition !== 'derived'
          // Get the variable by the variable name
          : variable.name === data.variableName && variable.type.definition !== 'derived',
  )

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
