import { buildExecuteNode, buildVariableNode } from '@root/frontend/components/_atoms/graphical-editor/fbd/buildNodes'
import type { FBDRungState } from '@root/frontend/store/slices'
import { parseFbdXml } from '@root/frontend/utils/PLC/xml-parser/language/fbd-xml'
import { collectExecuteStCode, parseXmlDocument } from '@root/frontend/utils/PLC/xml-parser/parse-xml-document'
import type { Edge, Node } from '@xyflow/react'
import { create } from 'xmlbuilder2'

import { fbdToXml } from '../fbd-xml'

// The FBD half of the Execute ("ST Block") element, in the neutral PLCOpen
// dialect. Unlike ladder, FBD wiring is free-form: `EN` may be fed from
// another node's output or left open entirely, and both have to survive the
// round trip — an open `EN` is what the transpiler reads as "runs every scan".

const SNIPPET = 'counter := counter + 1;'

function buildRung(wireEn: boolean): FBDRungState {
  const execute = buildExecuteNode({ id: 'X', position: { x: 200, y: 40 }, code: SNIPPET })
  const source = buildVariableNode({ id: 'IV', position: { x: 20, y: 40 }, variant: 'input-variable' })
  source.data.variable = { id: '', name: 'gate' }

  const edges: Edge[] = wireEn
    ? [
        {
          id: 'e1',
          source: 'IV',
          sourceHandle: source.data.outputConnector?.id,
          target: 'X',
          targetHandle: 'EN',
        },
      ]
    : []

  return {
    comment: '',
    selectedNodes: [],
    nodes: [source, execute] as unknown as Node[],
    edges,
  } as unknown as FBDRungState
}

type FbdBlockXml = Record<string, unknown>

const blockOf = (rung: FBDRungState): FbdBlockXml =>
  (fbdToXml(rung) as unknown as { body: { FBD: { block: FbdBlockXml[] } } }).body.FBD.block[0]

describe('old-editor fbdToXml — Execute element', () => {
  it('emits the element as a block with typeName EXECUTE and its snippet', () => {
    const block = blockOf(buildRung(true))

    expect(block['@typeName']).toBe('EXECUTE')
    const addData = block.addData as { data: Record<string, unknown> }
    expect(addData.data['@name']).toBe('http://openplc.org/plcopenxml/stcode')
    expect((addData.data.STCode as { '#': string })['#']).toBe(SNIPPET)
  })

  it('carries no CODESYS FBD descriptors — those belong to the CODESYS export', () => {
    const addData = blockOf(buildRung(true)).addData as { data: unknown }

    expect(Array.isArray(addData.data)).toBe(false)
  })

  it('declares EN and ENO, wiring EN to whatever feeds it', () => {
    const block = blockOf(buildRung(true))
    const inputs = block.inputVariables as {
      variable: { '@formalParameter': string; connectionPointIn: { connection: { '@refLocalId': string }[] } }[]
    }
    const outputs = block.outputVariables as { variable: { '@formalParameter': string }[] }

    expect(inputs.variable.map((v) => v['@formalParameter'])).toEqual(['EN'])
    expect(inputs.variable[0].connectionPointIn.connection).toHaveLength(1)
    expect(outputs.variable.map((v) => v['@formalParameter'])).toEqual(['ENO'])
  })

  it('leaves EN declared but unconnected when nothing feeds it', () => {
    const block = blockOf(buildRung(false))
    const inputs = block.inputVariables as {
      variable: { '@formalParameter': string; connectionPointIn: { connection: unknown[] } }[]
    }

    expect(inputs.variable[0]['@formalParameter']).toBe('EN')
    expect(inputs.variable[0].connectionPointIn.connection).toEqual([])
  })

  it('round-trips through serialized XML with the snippet byte-identical', () => {
    const xml = fbdToXml(buildRung(true)) as unknown as { body: unknown }
    const serialized = create({
      project: { types: { pous: { pou: { '@name': 'Main', body: xml.body } } } },
    }).end({ prettyPrint: true })

    const project = parseXmlDocument(serialized)
    const fbdXml = (project.types as { pous: { pou: { body: { FBD: unknown } }[] } }).pous.pou[0].body.FBD

    const { body, warnings } = parseFbdXml('Main', fbdXml, collectExecuteStCode(serialized))

    expect(warnings).toEqual([])
    const executes = body.rung.nodes.filter((node) => node.type === 'execute')
    expect(executes).toHaveLength(1)
    expect((executes[0].data as { code: string }).code).toBe(SNIPPET)

    // The EN edge must rebuild against the pin the generator named, not the
    // anonymous leaf handle a non-block source would use.
    const enEdge = body.rung.edges.find((edge) => edge.target === executes[0].id)
    expect(enEdge?.targetHandle).toBe('EN')
  })
})
