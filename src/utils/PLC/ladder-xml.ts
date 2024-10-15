import { ContactNode } from '@root/renderer/components/_atoms/react-flow/custom-nodes/contact'
import { RungState } from '@root/renderer/store/slices'
import { ContactLadderXML } from '@root/types/PLC/language-data/ladder-diagram'

const contactToXML = (contact: ContactNode, rung: RungState): ContactLadderXML => {
  const { nodes: rungNodes, edges: rungEdges } = rung

  const connectedEdges = rungEdges.filter((edge) => edge.source === contact.id)
  if (!connectedEdges.length) {
    return {
      'local-id': contact.id,
      negated: contact.data.variant === 'negated',
      edges:
        contact.data.variant === 'risingEdge' ? 'rising' : contact.data.variant === 'fallingEdge' ? 'falling' : undefined,
      width: contact.width as number,
      height: contact.height as number,
      position: contact.position,
      variable: '',
      'connection-point-in': {
        'relative-position': {
          ...(contact.data.inputConnector?.relPosition || { x: 0, y: 0 }),
        },
        connections: [],
      },
      'connection-point-out': {
        'relative-position': {
          ...(contact.data.outputConnector?.relPosition || { x: 0, y: 0 }),
        },
      },
    }
  }

  const connections = connectedEdges.map((edge) => {
    const sourceNode = rungNodes.find((node) => node.id === edge.source)
    if (!sourceNode) {
      return
    }

    if (sourceNode.type !== 'parallel') {
      return {
        'reference-to-local-id': sourceNode.id,
        positions: [
          {
            x: sourceNode.position.x,
            y: sourceNode.position.y,
          },
          {
            x: contact.data.inputConnector?.relPosition?.x || 0,
            y: contact.data.inputConnector?.relPosition?.y || 0,
          }
        ],
      }
    }

    return {

    }
  })

  return {
    'local-id': contact.id,
    negated: contact.data.variant === 'negated',
    edges:
      contact.data.variant === 'risingEdge' ? 'rising' : contact.data.variant === 'fallingEdge' ? 'falling' : undefined,
    width: contact.width as number,
    height: contact.height as number,
    position: contact.position,
    variable: '',
    'connection-point-in': {
      'relative-position': {
        ...(contact.data.inputConnector?.relPosition || { x: 0, y: 0 }),
      },
      connections: [],
    },
    'connection-point-out': {
      'relative-position': {
        ...(contact.data.outputConnector?.relPosition || { x: 0, y: 0 }),
      },
    },
  }
}
