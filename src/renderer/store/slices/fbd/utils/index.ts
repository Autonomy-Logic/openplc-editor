import { FBDRungState } from '../types'

export const duplicateFBDRung = (rung: FBDRungState) => {
  const newRung = { ...rung }
  newRung.selectedNodes = []

  const newNodes = newRung.nodes.map((node) => {
    return { ...node, id: `${node.type?.toUpperCase()}-${crypto.randomUUID()}` }
  })
  const nodeIdMap = new Map(rung.nodes.map((node, index) => [node.id, newNodes[index].id]))

  newRung.nodes = newNodes
  newRung.edges = newRung.edges.map((edge) => {
    return {
      id: `xy-edge_${nodeIdMap.get(edge.source)}_${nodeIdMap.get(edge.target)}`,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      source: nodeIdMap.get(edge.source) || edge.source,
      target: nodeIdMap.get(edge.target) || edge.target,
    }
  })

  return newRung
}
