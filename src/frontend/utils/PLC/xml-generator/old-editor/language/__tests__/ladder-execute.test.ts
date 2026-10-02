import { buildExecuteNode } from '@root/frontend/components/_atoms/graphical-editor/ladder/buildNodes'
import { nodesBuilder } from '@root/frontend/components/_atoms/graphical-editor/ladder/node-builders'
import type { RungLadderState } from '@root/frontend/store/slices'
import { parseLadderXml } from '@root/frontend/utils/PLC/xml-parser/language/ladder-xml'
import { collectExecuteStCode, parseXmlDocument } from '@root/frontend/utils/PLC/xml-parser/parse-xml-document'
import type { Edge, Node } from '@xyflow/react'
import { create } from 'xmlbuilder2'

import { ladderToXml } from '../ladder-xml'

// Export → import round trip for the Execute ("ST Block") element.
//
// The wire shape is a `<block typeName="EXECUTE">` carrying its source in an
// `<addData>` — the standard's own extension mechanism, since TC6 defines no
// inline-ST element. This is the NEUTRAL PLCOpen export, so it uses OpenPLC's
// URI; the CODESYS export uses 3S's.

const SNIPPET = 'IF a < 10 AND b THEN\n    total := total + 1;\nEND_IF;'

function buildRung(): RungLadderState {
  // `connector` names the side the rail's handle sits on, so the LEFT rail is
  // built with `connector: 'right'` and vice versa — same as startLadderRung.
  const rail = nodesBuilder.powerRail({ id: 'L', posX: 0, posY: 0, handleX: 0, handleY: 20, connector: 'right' })
  const execute = buildExecuteNode({ id: 'X', posX: 100, posY: 0, handleX: 100, handleY: 20, code: SNIPPET })
  const rightRail = nodesBuilder.powerRail({
    id: 'R',
    posX: 400,
    posY: 0,
    handleX: 400,
    handleY: 20,
    connector: 'left',
  })

  const edges: Edge[] = [
    {
      id: 'e1',
      source: 'L',
      sourceHandle: rail.data.outputConnector?.id,
      target: 'X',
      targetHandle: 'EN',
    },
    { id: 'e2', source: 'X', sourceHandle: 'ENO', target: 'R', targetHandle: rightRail.data.inputConnector?.id },
  ]

  return {
    id: 'rung-0',
    comment: '',
    defaultBounds: [800, 200],
    reactFlowViewport: [800, 200],
    nodes: [rail, execute, rightRail] as unknown as Node[],
    edges,
    selectedNodes: [],
    handleBranches: [],
  } as unknown as RungLadderState
}

describe('old-editor ladderToXml — Execute element', () => {
  const xml = ladderToXml([buildRung()]) as unknown as {
    body: { LD: { block: Record<string, unknown>[] } }
  }
  const block = xml.body.LD.block[0]

  it('emits the element as a block with typeName EXECUTE', () => {
    expect(block['@typeName']).toBe('EXECUTE')
  })

  it('declares EN and ENO as real formal parameters', () => {
    const inputs = (block.inputVariables as { variable: { '@formalParameter': string }[] }).variable
    const outputs = (block.outputVariables as { variable: { '@formalParameter': string }[] }).variable
    expect(inputs.map((v) => v['@formalParameter'])).toEqual(['EN'])
    expect(outputs.map((v) => v['@formalParameter'])).toEqual(['ENO'])
  })

  it('carries the snippet in an openplc.org addData, verbatim', () => {
    // The neutral PLCOpen export reproduces Beremiz / the legacy OpenPLC
    // Editor, which carries no vendor references anywhere — so this export
    // uses OpenPLC's own URI, not 3S's. `preserve` is the spec's "try to
    // preserve the additional data element", the right ask for a
    // standards-facing file. The CODESYS export uses 3S's instead.
    const data = (block.addData as { data: Record<string, unknown> }).data
    expect(data['@name']).toBe('http://openplc.org/plcopenxml/stcode')
    expect(data['@handleUnknown']).toBe('preserve')
    expect((data.STCode as { '#': string })['#']).toBe(SNIPPET)
  })

  it('omits executionOrderId when the user has not set one', () => {
    // CODESYS omits it entirely; matching that keeps a default export
    // byte-comparable with theirs.
    expect(block['@executionOrderId']).toBeUndefined()
  })

  // A REAL round trip: serialize to XML text with xmlbuilder2, then read it
  // back through the production parser. Going object → object would skip the
  // two things most likely to break — entity escaping of `<` / `&`, and the
  // whitespace trimming that would otherwise reindent the user's code.
  it('round-trips through serialized XML with the snippet byte-identical', () => {
    const serialized = create({ project: { types: { pous: { pou: { '@name': 'Main', body: xml.body } } } } }).end({
      prettyPrint: true,
    })

    // Escaped on the way out, exactly as CODESYS does it — never CDATA.
    expect(serialized).toContain('&lt;')

    const project = parseXmlDocument(serialized)
    const executeStCode = collectExecuteStCode(serialized)
    // `pou` is in the parser's ARRAY_TAGS, so it always arrives as an array.
    const ldXml = (project.types as { pous: { pou: { body: { LD: unknown } }[] } }).pous.pou[0].body.LD

    const { body, warnings } = parseLadderXml('Main', ldXml, executeStCode)
    expect(warnings).toEqual([])

    const executes = body.rungs.flatMap((rung) => rung.nodes.filter((node) => node.type === 'execute'))
    expect(executes).toHaveLength(1)
    expect((executes[0].data as { code: string }).code).toBe(SNIPPET)
  })
})
