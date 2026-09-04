import { buildExecuteNode } from '@root/frontend/components/_atoms/graphical-editor/ladder/buildNodes'
import { nodesBuilder } from '@root/frontend/components/_atoms/graphical-editor/ladder/node-builders'
import type { RungLadderState } from '@root/frontend/store/slices'
import type { Edge, Node } from '@xyflow/react'

import { ladderToXml } from '../ladder-xml'

// The CODESYS dialect for the Execute ("ST Block") element, exercised through
// the topology it is actually used in: contact → EXECUTE → coil.
//
// That shape is what makes this dialect distinct — its contact/coil emitters
// look up the *variant* of a block-shaped source to decide whether to name it
// by pin or by function name. An Execute element is block-shaped in the XML
// but carries no variant, so an unguarded lookup throws while exporting.

const SNIPPET = 'total := total + 1;'

function buildRung(): RungLadderState {
  // `connector` names the side the rail's handle sits on, so the LEFT rail is
  // built with `connector: 'right'` and vice versa — same as startLadderRung.
  const left = nodesBuilder.powerRail({ id: 'L', posX: 0, posY: 0, handleX: 0, handleY: 20, connector: 'right' })
  const contact = nodesBuilder.contact({ id: 'C', posX: 60, posY: 0, handleX: 60, handleY: 20, variant: 'default' })
  const execute = buildExecuteNode({ id: 'X', posX: 140, posY: 0, handleX: 140, handleY: 20, code: SNIPPET })
  const coil = nodesBuilder.coil({ id: 'K', posX: 420, posY: 0, handleX: 420, handleY: 20, variant: 'default' })
  const right = nodesBuilder.powerRail({ id: 'R', posX: 600, posY: 0, handleX: 600, handleY: 20, connector: 'left' })

  const edges: Edge[] = [
    {
      id: 'e1',
      source: 'L',
      sourceHandle: left.data.outputConnector?.id,
      target: 'C',
      targetHandle: contact.data.inputConnector?.id,
    },
    { id: 'e2', source: 'C', sourceHandle: contact.data.outputConnector?.id, target: 'X', targetHandle: 'EN' },
    { id: 'e3', source: 'X', sourceHandle: 'ENO', target: 'K', targetHandle: coil.data.inputConnector?.id },
    {
      id: 'e4',
      source: 'K',
      sourceHandle: coil.data.outputConnector?.id,
      target: 'R',
      targetHandle: right.data.inputConnector?.id,
    },
  ]

  return {
    id: 'rung-0',
    comment: '',
    defaultBounds: [800, 200],
    reactFlowViewport: [800, 200],
    nodes: [left, contact, execute, coil, right] as unknown as Node[],
    edges,
    selectedNodes: [],
    handleBranches: [],
  } as unknown as RungLadderState
}

describe('codesys ladderToXml — Execute element', () => {
  const xml = ladderToXml([buildRung()]) as unknown as {
    body: {
      LD: {
        block: Record<string, unknown>[]
        coil: Record<string, unknown>[]
      }
    }
  }

  it('emits the element as a block with typeName EXECUTE', () => {
    expect(xml.body.LD.block[0]['@typeName']).toBe('EXECUTE')
  })

  it("carries the snippet in 3S's stcode addData", () => {
    const addData = xml.body.LD.block[0].addData as { data: Record<string, unknown> }
    expect(addData.data['@name']).toBe('http://www.3s-software.com/plcopenxml/stcode')
    expect((addData.data.STCode as { '#': string })['#']).toBe(SNIPPET)
  })

  it('names the ENO pin on a downstream coil', () => {
    // Without the pin name the importer cannot tell which output the coil
    // reads, and rebuilds the edge against a handle that does not exist.
    const connectionPointIn = xml.body.LD.coil[0].connectionPointIn as {
      connection: { '@refLocalId': string; '@formalParameter'?: string }[]
    }
    expect(connectionPointIn.connection[0]['@formalParameter']).toBe('ENO')
    expect(connectionPointIn.connection[0]['@refLocalId']).toBe(
      (xml.body.LD.block[0]['@localId'] as string | number).toString(),
    )
  })
})
