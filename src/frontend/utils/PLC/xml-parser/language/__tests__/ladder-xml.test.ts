import type { BlockNode, BlockVariant } from '@root/frontend/components/_atoms/graphical-editor/ladder/utils/types'

import { parseLadderXml } from '../ladder-xml'

describe('parseLadderXml', () => {
  it('returns no rungs for an empty LD body', () => {
    const { body, warnings } = parseLadderXml('empty', {})
    expect(warnings).toEqual([])
    expect(body).toEqual({ name: 'empty', updated: false, rungs: [] })
  })

  it('reconstructs a single rung: left rail -> contact -> coil -> right rail', () => {
    const { body, warnings } = parseLadderXml('rung1', {
      leftPowerRail: [
        {
          '@localId': '1',
          '@width': '20',
          '@height': '40',
          position: { '@x': '0', '@y': '0' },
          connectionPointOut: { relPosition: { '@x': '20', '@y': '20' } },
        },
      ],
      contact: [
        {
          '@localId': '2',
          '@negated': 'false',
          '@width': '40',
          '@height': '40',
          position: { '@x': '50', '@y': '0' },
          connectionPointIn: {
            relPosition: { '@x': '0', '@y': '20' },
            connection: [{ '@refLocalId': '1', '@formalParameter': 'left-rail' }],
          },
          connectionPointOut: { relPosition: { '@x': '40', '@y': '20' } },
          variable: ['X1'],
        },
      ],
      coil: [
        {
          '@localId': '3',
          '@negated': 'false',
          '@width': '40',
          '@height': '40',
          position: { '@x': '100', '@y': '0' },
          connectionPointIn: {
            relPosition: { '@x': '0', '@y': '20' },
            connection: [{ '@refLocalId': '2', '@formalParameter': 'output' }],
          },
          connectionPointOut: { relPosition: { '@x': '40', '@y': '20' } },
          variable: ['Y1'],
        },
      ],
      rightPowerRail: [
        {
          '@localId': '4',
          '@width': '20',
          '@height': '40',
          position: { '@x': '150', '@y': '0' },
          connectionPointIn: {
            relPosition: { '@x': '0', '@y': '20' },
            connection: [{ '@refLocalId': '3', '@formalParameter': 'output' }],
          },
        },
      ],
    })

    expect(warnings).toEqual([])
    expect(body.rungs).toHaveLength(1)
    const rung = body.rungs[0]
    // Node order within a rung follows the raw XML's element-type grouping
    // (leftPowerRail, rightPowerRail, contact, coil, ...) — see
    // parseLadderXml's node-collection loop — not rung/visual position.
    expect(rung.nodes.map((n) => n.id)).toEqual(['LEFT-POWER-RAIL-1', 'RIGHT-POWER-RAIL-4', 'CONTACT-2', 'COIL-3'])
    // Edge order follows pendingEdges collection order (grouped by the
    // consuming node's XML element type), not visual left-to-right order —
    // compare as a set of {source,target} pairs instead of an exact sequence.
    expect(rung.edges).toHaveLength(3)
    expect(rung.edges.map((e) => `${e.source}->${e.target}`).sort()).toEqual(
      ['LEFT-POWER-RAIL-1->CONTACT-2', 'CONTACT-2->COIL-3', 'COIL-3->RIGHT-POWER-RAIL-4'].sort(),
    )
    expect(rung.edges.every((e) => e.type === 'smoothstep')).toBe(true)
    expect((rung.nodes[2].data as { variable: { name: string } }).variable).toEqual({ name: 'X1' })
    expect((rung.nodes[3].data as { variable: { name: string } }).variable).toEqual({ name: 'Y1' })
    expect(rung.defaultBounds).toEqual([0, 0, 170, 40])
    expect(rung.reactFlowViewport).toEqual([170, 40])
  })

  it('partitions disconnected nodes into separate rungs', () => {
    const { body } = parseLadderXml('tworungs', {
      leftPowerRail: [
        {
          '@localId': '1',
          '@width': '20',
          '@height': '40',
          position: { '@x': '0', '@y': '0' },
          connectionPointOut: { relPosition: { '@x': '20', '@y': '20' } },
        },
        {
          '@localId': '2',
          '@width': '20',
          '@height': '40',
          position: { '@x': '0', '@y': '100' },
          connectionPointOut: { relPosition: { '@x': '20', '@y': '20' } },
        },
      ],
    })
    expect(body.rungs).toHaveLength(2)
  })

  it('parses coil variants: negated, rising edge, falling edge, set, reset', () => {
    const makeCoil = (localId: string, attrs: Record<string, string>) => ({
      '@localId': localId,
      '@width': '40',
      '@height': '40',
      position: { '@x': '0', '@y': '0' },
      connectionPointIn: { relPosition: { '@x': '0', '@y': '20' } },
      connectionPointOut: { relPosition: { '@x': '40', '@y': '20' } },
      variable: ['Y'],
      ...attrs,
    })
    const { body } = parseLadderXml('p', {
      coil: [
        makeCoil('1', { '@negated': 'true' }),
        makeCoil('2', { '@edge': 'rising' }),
        makeCoil('3', { '@edge': 'falling' }),
        makeCoil('4', { '@storage': 'set' }),
        makeCoil('5', { '@storage': 'reset' }),
        makeCoil('6', {}),
      ],
    })
    const variants = body.rungs.flatMap((r) => r.nodes).map((n) => (n.data as { variant: string }).variant)
    expect(variants).toEqual(['negated', 'risingEdge', 'fallingEdge', 'set', 'reset', 'default'])
  })

  it('parses contact variants: negated, rising edge, falling edge, default', () => {
    const makeContact = (localId: string, attrs: Record<string, string>) => ({
      '@localId': localId,
      '@width': '40',
      '@height': '40',
      position: { '@x': '0', '@y': '0' },
      connectionPointIn: { relPosition: { '@x': '0', '@y': '20' } },
      connectionPointOut: { relPosition: { '@x': '40', '@y': '20' } },
      variable: ['X'],
      ...attrs,
    })
    const { body } = parseLadderXml('p', {
      contact: [
        makeContact('1', { '@negated': 'true' }),
        makeContact('2', { '@edge': 'rising' }),
        makeContact('3', { '@edge': 'falling' }),
        makeContact('4', {}),
      ],
    })
    const variants = body.rungs.flatMap((r) => r.nodes).map((n) => (n.data as { variant: string }).variant)
    expect(variants).toEqual(['negated', 'risingEdge', 'fallingEdge', 'default'])
  })

  it('parses a function-block instance and a plain function call', () => {
    const { body } = parseLadderXml('p', {
      block: [
        {
          '@localId': '1',
          '@typeName': 'TON',
          '@instanceName': 'ton1',
          '@executionOrderId': '0',
          '@width': '100',
          '@height': '60',
          position: { '@x': '0', '@y': '0' },
          inputVariables: {
            variable: [{ '@formalParameter': 'IN', connectionPointIn: { relPosition: { '@x': '0', '@y': '10' } } }],
          },
          outputVariables: {
            // Unnamed return pin — formalParameter="" maps to the 'OUT' sentinel handle id.
            variable: [{ '@formalParameter': '', connectionPointOut: { relPosition: { '@x': '100', '@y': '10' } } }],
          },
        },
      ],
    })
    const node = body.rungs[0].nodes[0] as BlockNode<BlockVariant>
    expect(node.data.variable).toEqual({ name: 'ton1' })
    expect(node.data.outputHandles[0].id).toBe('OUT')
    expect(node.data.variant.type).toBe('function-block')
  })

  it("resolves a pending edge into a block's non-main input pin", () => {
    const { body, warnings } = parseLadderXml('p', {
      contact: [
        {
          '@localId': '1',
          '@width': '40',
          '@height': '40',
          position: { '@x': '0', '@y': '0' },
          connectionPointIn: { relPosition: { '@x': '0', '@y': '20' } },
          connectionPointOut: { relPosition: { '@x': '40', '@y': '20' } },
          variable: ['X1'],
        },
      ],
      block: [
        {
          '@localId': '2',
          '@typeName': 'CTU',
          '@executionOrderId': '0',
          '@width': '100',
          '@height': '60',
          position: { '@x': '50', '@y': '0' },
          inputVariables: {
            variable: [
              {
                '@formalParameter': 'PV',
                connectionPointIn: {
                  relPosition: { '@x': '0', '@y': '30' },
                  connection: [{ '@refLocalId': '1', '@formalParameter': 'output' }],
                },
              },
            ],
          },
          outputVariables: '',
        },
      ],
    })
    expect(warnings).toEqual([])
    const blockNode = body.rungs[0].nodes.find((n) => n.id === 'BLOCK-2') as BlockNode<BlockVariant> | undefined
    expect(blockNode?.data.inputHandles[0].id).toBe('PV')
    expect(body.rungs[0].edges).toContainEqual(
      expect.objectContaining({ source: 'CONTACT-1', sourceHandle: 'output', target: 'BLOCK-2', targetHandle: 'PV' }),
    )
  })

  it('parses inVariable/outVariable leaf nodes and resolves the block-fed edge', () => {
    const { body, warnings } = parseLadderXml('p', {
      block: [
        {
          '@localId': '1',
          '@typeName': 'ADD',
          '@executionOrderId': '0',
          '@width': '100',
          '@height': '60',
          position: { '@x': '0', '@y': '0' },
          inputVariables: '',
          outputVariables: {
            variable: [{ '@formalParameter': 'OUT', connectionPointOut: { relPosition: { '@x': '100', '@y': '10' } } }],
          },
        },
      ],
      inVariable: [
        {
          '@localId': '2',
          '@width': '80',
          '@height': '30',
          position: { '@x': '0', '@y': '100' },
          connectionPointOut: { relPosition: { '@x': '80', '@y': '15' } },
          expression: 'LIT1',
        },
      ],
      outVariable: [
        {
          '@localId': '3',
          '@width': '80',
          '@height': '30',
          position: { '@x': '200', '@y': '0' },
          connectionPointIn: {
            relPosition: { '@x': '0', '@y': '15' },
            connection: [{ '@refLocalId': '1', '@formalParameter': 'OUT' }],
          },
          expression: 'RESULT',
        },
      ],
    })
    expect(warnings).toEqual([])
    // The unconnected inVariable literal forms its own rung (no edge ties it
    // to the block/outVariable component) — search across all rungs.
    const allNodes = body.rungs.flatMap((r) => r.nodes)
    const outVarNode = allNodes.find((n) => n.id === 'OUTPUT-VARIABLE-3')
    expect(outVarNode?.data.block).toEqual({
      id: '',
      handleId: 'OUT',
      variableType: { name: '', class: '', type: { definition: 'base-type', value: '' } },
    })
    const inVarNode = allNodes.find((n) => n.id === 'INPUT-VARIABLE-2')
    expect(inVarNode?.data.variable).toEqual({ name: 'LIT1' })
  })

  it('warns (non-fatally) about inOutVariable nodes', () => {
    const { warnings } = parseLadderXml('p', { inOutVariable: [{}] })
    expect(warnings).toEqual(['POU "p": 1 LD inOutVariable node(s) are not supported, skipped'])
  })

  it('warns (non-fatally) about a dangling connection reference', () => {
    const { body, warnings } = parseLadderXml('p', {
      coil: [
        {
          '@localId': '1',
          '@width': '40',
          '@height': '40',
          position: { '@x': '0', '@y': '0' },
          connectionPointIn: {
            relPosition: { '@x': '0', '@y': '20' },
            connection: [{ '@refLocalId': 'doesnotexist', '@formalParameter': 'left-rail' }],
          },
          connectionPointOut: { relPosition: { '@x': '40', '@y': '20' } },
          variable: ['Y'],
        },
      ],
    })
    expect(body.rungs[0].edges).toEqual([])
    expect(warnings).toEqual(['POU "p": LD connection references unknown localId "doesnotexist", skipped'])
  })
})
