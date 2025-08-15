import { FBDRungState } from '../types'

export const duplicateFBDRung = (rung: FBDRungState) => {
  const newRung = { ...rung }
  newRung.selectedNodes = []

  const newNodes = newRung.nodes.map((node) => {
    return { ...node, id: `${(node.type ?? 'node').toUpperCase()}-${crypto.randomUUID()}` }
  })
  const nodeIdMap = new Map(rung.nodes.map((node, index) => [node.id, newNodes[index].id]))

  newRung.nodes = newNodes
  const remap = (id: string) => nodeIdMap.get(id) ?? id
  newRung.edges = newRung.edges.map((edge) => ({
    ...edge,
    id: `xy-edge_${remap(edge.source)}_${remap(edge.target)}`,
    source: remap(edge.source),
    target: remap(edge.target),
  }))

  return newRung
}
