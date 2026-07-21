import { BlockNode } from '@root/frontend/components/_atoms/graphical-editor/fbd/block'
import type { VariableNode } from '@root/frontend/components/_atoms/graphical-editor/fbd/utils/types'
import type { BlockVariant } from '@root/frontend/components/_atoms/graphical-editor/types/block'

import { parseFbdXml } from '../fbd-xml'

describe('parseFbdXml', () => {
  it('returns an empty rung for an empty FBD body', () => {
    const { body, warnings } = parseFbdXml('empty', {})
    expect(warnings).toEqual([])
    expect(body).toEqual({
      name: 'empty',
      updated: false,
      rung: { comment: '', nodes: [], edges: [], selectedNodes: [] },
    })
  })

  it('parses an input-variable node', () => {
    const { body } = parseFbdXml('p', {
      inVariable: [
        {
          '@localId': '1',
          '@executionOrderId': '0',
          '@width': '80',
          '@height': '30',
          '@negated': 'false',
          position: { '@x': '0', '@y': '0' },
          connectionPointOut: { relPosition: { '@x': '80', '@y': '15' } },
          expression: 'X1',
        },
      ],
    })
    const node = body.rung.nodes[0] as VariableNode
    expect(node.id).toBe('INPUT-VARIABLE-1')
    expect(node.type).toBe('input-variable')
    expect(node.data.variable).toEqual({ name: 'X1' })
    expect(node.data.negated).toBe(false)
    expect(node.data.outputHandles[0].id).toBe('output-variable')
  })

  it('parses an output-variable node and resolves its connection into an edge', () => {
    const { body, warnings } = parseFbdXml('p', {
      inVariable: [
        {
          '@localId': '1',
          '@executionOrderId': '0',
          '@width': '80',
          '@height': '30',
          '@negated': 'false',
          position: { '@x': '0', '@y': '0' },
          connectionPointOut: { relPosition: { '@x': '80', '@y': '15' } },
          expression: 'X1',
        },
      ],
      outVariable: [
        {
          '@localId': '2',
          '@executionOrderId': '1',
          '@width': '80',
          '@height': '30',
          '@negated': 'true',
          position: { '@x': '200', '@y': '0' },
          connectionPointIn: {
            relPosition: { '@x': '0', '@y': '15' },
            connection: [{ '@refLocalId': '1' }],
          },
          expression: 'Y1',
        },
      ],
    })
    expect(warnings).toEqual([])
    expect(body.rung.nodes).toHaveLength(2)
    expect(body.rung.edges).toEqual([
      {
        id: 'xy-edge__INPUT-VARIABLE-1output-variable-OUTPUT-VARIABLE-2input-variable',
        source: 'INPUT-VARIABLE-1',
        sourceHandle: 'output-variable',
        target: 'OUTPUT-VARIABLE-2',
        targetHandle: 'input-variable',
        type: 'smoothstep',
      },
    ])
    const outNode = body.rung.nodes[1]
    expect(outNode.data.negated).toBe(true)
  })

  it('parses a block with a function-block instance name and deduped input handles', () => {
    const { body } = parseFbdXml('p', {
      block: [
        {
          '@localId': '3',
          '@typeName': 'TON',
          '@instanceName': 'ton1',
          '@executionOrderId': '2',
          '@width': '100',
          '@height': '60',
          position: { '@x': '50', '@y': '50' },
          inputVariables: {
            variable: [
              {
                '@formalParameter': 'IN',
                connectionPointIn: { relPosition: { '@x': '0', '@y': '10' }, connection: [{ '@refLocalId': '1' }] },
              },
              {
                // Same formalParameter, second incoming edge — must be deduped to one handle.
                '@formalParameter': 'IN',
                connectionPointIn: { relPosition: { '@x': '0', '@y': '10' }, connection: [{ '@refLocalId': '2' }] },
              },
            ],
          },
          outputVariables: {
            variable: [{ '@formalParameter': 'Q', connectionPointOut: { relPosition: { '@x': '100', '@y': '10' } } }],
          },
        },
      ],
    })
    const node = body.rung.nodes[0] as BlockNode<BlockVariant>
    expect(node.id).toBe('BLOCK-3')
    expect(node.data.inputHandles).toHaveLength(1)
    expect(node.data.variable).toEqual({ name: 'ton1' })
    expect(node.data.variant.type).toBe('function-block')
  })

  it('parses a block that is a plain function call (no @instanceName)', () => {
    const { body } = parseFbdXml('p', {
      block: [
        {
          '@localId': '4',
          '@typeName': 'ADD',
          '@executionOrderId': '0',
          '@width': '60',
          '@height': '40',
          position: { '@x': '0', '@y': '0' },
          inputVariables: '',
          outputVariables: '',
        },
      ],
    })
    const node = body.rung.nodes[0] as BlockNode<BlockVariant>
    expect(node.data.variable).toEqual({ name: 'ADD' })
    expect(node.data.variant.type).toBe('function')
  })

  it('parses a connector/continuation pair', () => {
    const { body } = parseFbdXml('p', {
      connector: [
        {
          '@name': 'c1',
          '@localId': '5',
          '@width': '40',
          '@height': '20',
          position: { '@x': '0', '@y': '0' },
          connectionPointIn: { relPosition: { '@x': '0', '@y': '10' }, connection: [{ '@refLocalId': '1' }] },
        },
      ],
      continuation: [
        {
          '@name': 'c1',
          '@localId': '6',
          '@width': '40',
          '@height': '20',
          position: { '@x': '100', '@y': '0' },
          connectionPointOut: { relPosition: { '@x': '40', '@y': '10' } },
        },
      ],
      inVariable: [
        {
          '@localId': '1',
          '@executionOrderId': '0',
          '@width': '80',
          '@height': '30',
          '@negated': 'false',
          position: { '@x': '0', '@y': '0' },
          connectionPointOut: { relPosition: { '@x': '80', '@y': '15' } },
          expression: 'X1',
        },
      ],
    })
    const connector = body.rung.nodes.find((n) => n.type === 'connector')
    const continuation = body.rung.nodes.find((n) => n.type === 'continuation')
    expect(connector?.data.variable).toEqual({ name: 'c1' })
    expect(continuation?.data.variable).toEqual({ name: 'c1' })
  })

  it('un-placeholders "No comment provided" back to an empty string', () => {
    const { body } = parseFbdXml('p', {
      comment: [
        {
          '@localId': '7',
          '@width': '100',
          '@height': '40',
          position: { '@x': '0', '@y': '0' },
          content: { 'xhtml:p': 'No comment provided' },
        },
      ],
    })
    expect(body.rung.nodes[0].data.content).toBe('')
  })

  it('keeps real comment text', () => {
    const { body } = parseFbdXml('p', {
      comment: [
        {
          '@localId': '8',
          '@width': '100',
          '@height': '40',
          position: { '@x': '0', '@y': '0' },
          content: { 'xhtml:p': 'Real comment' },
        },
      ],
    })
    expect(body.rung.nodes[0].data.content).toBe('Real comment')
  })

  it('warns (non-fatally) about inOutVariable nodes', () => {
    const { warnings } = parseFbdXml('p', { inOutVariable: [{}] })
    expect(warnings).toEqual(['POU "p": 1 FBD inOutVariable node(s) are not supported, skipped'])
  })

  it('warns (non-fatally) about a dangling connection reference', () => {
    const { body, warnings } = parseFbdXml('p', {
      outVariable: [
        {
          '@localId': '9',
          '@executionOrderId': '0',
          '@width': '80',
          '@height': '30',
          '@negated': 'false',
          position: { '@x': '0', '@y': '0' },
          connectionPointIn: {
            relPosition: { '@x': '0', '@y': '15' },
            connection: [{ '@refLocalId': 'doesnotexist' }],
          },
          expression: 'Y1',
        },
      ],
    })
    expect(body.rung.edges).toEqual([])
    expect(warnings).toEqual(['POU "p": FBD connection references unknown localId "doesnotexist", skipped'])
  })
})
