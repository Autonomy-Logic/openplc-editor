import { newGraphicalEditorNodeID } from '@root/utils/new-graphical-editor-node-id'

import { FBDRungState } from '../types'

export const duplicateFBDRung = (rung: FBDRungState) => {
  const newRung = { ...rung, id: `rung_${crypto.randomUUID()}` }
  newRung.selectedNodes = []

  const newNodes = newRung.nodes.map((node) => {
    return { ...node, id: newGraphicalEditorNodeID(node.type?.toUpperCase()) }
  })
  const nodeIdMap = new Map(rung.nodes.map((node, index) => [node.id, newNodes[index].id]))

  newRung.nodes = newNodes

  const remap = (id: string) => nodeIdMap.get(id) ?? id
  newRung.edges = newRung.edges.map((edge) => ({
    ...edge,
    id: `xy-edge_${remap(edge.source)}_${remap(edge.target)}__${edge.sourceHandle ?? ''}_${edge.targetHandle ?? ''}`,
    source: remap(edge.source),
    target: remap(edge.target),
  }))

  return newRung
}
