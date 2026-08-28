import { buildExecuteNode, buildVariableNode } from '@root/frontend/components/_atoms/graphical-editor/fbd/buildNodes'
import type { FBDRungState } from '@root/frontend/store/slices'
import type { Edge, Node } from '@xyflow/react'

import { fbdToXml } from '../fbd-xml'

// The CODESYS dialect for an FBD Execute ("ST Block") element.
//
// It differs from the neutral export in one visible way: alongside the
// snippet, CODESYS writes three descriptor entries that only ever appear on
// FBD blocks. Reproducing them is what lets CODESYS reimport the element as a
// real ST Block rather than an unknown POU call.

const SNIPPET = 'level := level + 1;'

const CODESYS_URI = 'http://www.3s-software.com/plcopenxml/'

function buildRung(): FBDRungState {
  const execute = buildExecuteNode({ id: 'X', position: { x: 200, y: 40 }, code: SNIPPET })
  const source = buildVariableNode({ id: 'IV', position: { x: 20, y: 40 }, variant: 'input-variable' })
  source.data.variable = { id: '', name: 'gate' }

  const edges: Edge[] = [
    { id: 'e1', source: 'IV', sourceHandle: source.data.outputConnector?.id, target: 'X', targetHandle: 'EN' },
  ]

  return {
    comment: '',
    selectedNodes: [],
    nodes: [source, execute] as unknown as Node[],
    edges,
  } as unknown as FBDRungState
}

describe('codesys fbdToXml — Execute element', () => {
  const block = (fbdToXml(buildRung()) as unknown as { body: { FBD: { block: Record<string, unknown>[] } } }).body.FBD
    .block[0]
  const entries = (block.addData as { data: { '@name': string; STCode?: { '#': string } }[] }).data

  it('emits the element as a block with typeName EXECUTE', () => {
    expect(block['@typeName']).toBe('EXECUTE')
  })

  it("writes the FBD-only descriptors alongside 3S's stcode", () => {
    expect(entries.map((entry) => entry['@name'])).toEqual([
      `${CODESYS_URI}fbdcalltype`,
      `${CODESYS_URI}inputparamtypes`,
      `${CODESYS_URI}outputparamtypes`,
      `${CODESYS_URI}stcode`,
    ])
  })

  it('carries the snippet verbatim under the stcode entry', () => {
    const stCode = entries.find((entry) => entry['@name'] === `${CODESYS_URI}stcode`)
    expect(stCode?.STCode?.['#']).toBe(SNIPPET)
  })

  it('declares EN wired to its source and ENO as an output', () => {
    const inputs = block.inputVariables as {
      variable: { '@formalParameter': string; connectionPointIn: { connection: unknown[] } }[]
    }
    const outputs = block.outputVariables as { variable: { '@formalParameter': string }[] }

    expect(inputs.variable[0]['@formalParameter']).toBe('EN')
    expect(inputs.variable[0].connectionPointIn.connection).toHaveLength(1)
    expect(outputs.variable.map((v) => v['@formalParameter'])).toEqual(['ENO'])
  })
})
