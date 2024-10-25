import type { EditorModel, FlowType } from '@root/renderer/store/slices'
import type { PLCPou } from '@root/types/PLC/open-plc'
import type { PLCVariable } from '@root/types/PLC/units/variable'

export const getPouVariablesRungNodeAndEdges = (
  editor: EditorModel,
  pous: PLCPou[],
  flows: FlowType[],
  data: { nodeId: string; variableName: string },
) => {
  const pou = pous.find((pou) => pou.data.name === editor.meta.name)
  if (!pou) return null

  const rung = flows
    .find((flow) => flow.name === editor.meta.name)
    ?.rungs.find((rung) => rung.nodes.some((node) => node.id === data.nodeId))
  if (!rung) return null

  const node = rung.nodes.find((node) => node.id === data.nodeId)

  const variables: PLCVariable[] = pou.data.variables as PLCVariable[]
  const variable = variables.find((variable) =>
    node?.type === 'block'
      ? variable.id === node.id
      : variable.name === data.variableName && variable.type.definition !== 'derived',
  )

  const edgesThatNodeIsSource = rung.edges.filter((edge) => edge.source === data.nodeId)
  const edgesThatNodeIsTarget = rung.edges.filter((edge) => edge.target === data.nodeId)

  return {
    pou,
    rung,
    variables: { all: variables, selected: variable },
    edges: { source: edgesThatNodeIsSource, target: edgesThatNodeIsTarget },
    node,
  }
}
