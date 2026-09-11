/**
 * The port-shape → transpiler IR projection, on the shared surface.
 *
 * Two things are proved: nothing the model or the compiler needs is dropped on the way
 * across — a graphical POU is a React Flow graph and nothing else, and a reference that
 * lives in a node's variable name has to survive — and the projection never throws on a
 * body it cannot read, because a chat turn or a compile is what would go down with it.
 */

import { describe, expect, it } from '@jest/globals'

import type { PLCPou, PLCProjectData, PLCVariable } from '../../../../middleware/shared/ports/types'
import { fromPortShape } from '../transpile-from-port'

function variable(overrides: Partial<PLCVariable> & { name: string }): PLCVariable {
  return {
    type: { definition: 'base-type', value: 'BOOL' },
    location: '',
    documentation: '',
    ...overrides,
  }
}

function pou(overrides: Partial<PLCPou> & { name: string; body: PLCPou['body'] }): PLCPou {
  return { pouType: 'program', interface: { variables: [] }, ...overrides }
}

const EMPTY_RESOURCE: PLCProjectData['configurations'] = {
  resource: { tasks: [], instances: [], globalVariables: [] },
}

/** One rung with a contact and a coil, in the shape the ladder slice stores. */
const LADDER_BODY = {
  rungs: [
    {
      id: 'rung-1',
      comment: 'start',
      reactFlowViewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        { id: 'left-rail', type: 'powerRail', position: { x: 0, y: 0 }, data: { variant: 'left' } },
        { id: 'contact-1', type: 'contact', position: { x: 100, y: 0 }, data: { variable: { name: 'Start' } } },
        { id: 'coil-1', type: 'coil', position: { x: 200, y: 0 }, data: { variable: { name: 'GVL.Output1' } } },
        { id: 'right-rail', type: 'powerRail', position: { x: 300, y: 0 }, data: { variant: 'right' } },
      ],
      edges: [
        { id: 'e1', source: 'left-rail', target: 'contact-1', sourceHandle: 'a', targetHandle: 'b' },
        { id: 'e2', source: 'contact-1', target: 'coil-1' },
        { id: 'e3', source: 'coil-1', target: 'right-rail' },
      ],
    },
  ],
}

const FBD_BODY = {
  rung: {
    comment: 'fbd',
    nodes: [{ id: 'n1', type: 'variable', position: { x: 1, y: 2 }, data: { variable: { name: 'Flag' } } }],
    edges: [{ id: 'e1', source: 'n1', target: 'n1' }],
  },
}

/** A project that exercises every branch of the projection at once. */
function fullProject(): PLCProjectData {
  return {
    dataTypes: [
      {
        name: 'Motor',
        derivation: 'structure',
        variable: [
          {
            name: 'speed',
            type: { definition: 'base-type', value: 'INT' },
            initialValue: { simpleValue: { value: '10' } },
            documentation: 'rpm',
          },
          { name: 'running', type: { definition: 'base-type', value: 'BOOL' } },
          {
            name: 'empty',
            type: { definition: 'base-type', value: 'INT' },
            initialValue: { simpleValue: { value: '' } },
          },
        ],
      },
      { name: 'Colour', derivation: 'enumerated', initialValue: 'RED', values: [{ description: 'RED' }] },
      { name: 'Mode', derivation: 'enumerated', values: [{ description: 'AUTO' }] },
      {
        name: 'Readings',
        derivation: 'array',
        baseType: { definition: 'base-type', value: 'INT' },
        initialValue: '[0,0]',
        dimensions: [{ dimension: '1..2' }],
      },
      {
        name: 'Nested',
        derivation: 'array',
        baseType: { definition: 'array', value: 'Readings' },
        dimensions: [{ dimension: '1..2' }],
      },
    ],
    globalVariableLists: [
      { name: 'GVL', variables: [variable({ name: 'Output1', initialValue: 'TRUE', documentation: 'lamp' })] },
      // Referenced by nobody, so no POU gains a `VAR_EXTERNAL` for it.
      { name: 'Unused', variables: [variable({ name: 'Spare' })] },
      // Empty: an empty STRUCT is not a legal type, so it is dropped entirely.
      { name: 'Blank', variables: [] },
    ],
    pous: [
      pou({
        name: 'Main',
        documentation: 'main program',
        interface: {
          variables: [
            variable({ name: 'Start', class: 'input', location: '%IX0.0', initialValue: 'FALSE', documentation: 'go' }),
            variable({ name: 'Motor', class: 'output' }),
            // 'global' has no IR equivalent and is folded onto 'local'.
            variable({ name: 'Shared', class: 'global' }),
            variable({ name: 'Empty', initialValue: '' }),
            variable({ name: 'Nulled', initialValue: null }),
            variable({ name: 'Drive', type: { definition: 'derived', value: 'TON' } }),
            variable({ name: 'Engine', type: { definition: 'user-data-type', value: 'Motor' } }),
            variable({
              name: 'Samples',
              type: {
                definition: 'array',
                value: 'ARRAY',
                data: { baseType: { definition: 'base-type', value: 'INT' }, dimensions: [{ dimension: '1..4' }] },
              },
            }),
          ],
        },
        body: { language: 'st', value: 'Motor := Start AND GVL.Output1;' },
      }),
      pou({ name: 'Ladder', body: { language: 'ld', value: LADDER_BODY } }),
      pou({ name: 'Blocks', body: { language: 'fbd', value: FBD_BODY } }),
      pou({
        name: 'Compute',
        pouType: 'function',
        interface: {
          returnType: 'INT',
          variables: [variable({ name: 'x', type: { definition: 'base-type', value: 'INT' } })],
        },
        body: { language: 'il', value: 'LD 1\nST Compute' },
      }),
      pou({ name: 'Script', body: { language: 'python', value: 'pass' } }),
      pou({ name: 'Native', body: { language: 'cpp', value: '// c++' } }),
      // Not ported yet: falls back to ST passthrough rather than crashing a fixture.
      pou({ name: 'Steps', body: { language: 'sfc', value: 'flag := TRUE;' } }),
    ],
    configurations: {
      resource: {
        tasks: [
          { name: 'Fast', triggering: 'Cyclic', interval: 'T#20ms', priority: 0 },
          { name: 'OnEdge', triggering: 'Interrupt', interval: 'T#0ms', priority: 1 },
        ],
        instances: [
          { name: 'inst0', task: 'Fast', program: 'Main' },
          { name: 'inst1', task: '', program: 'Ladder' },
        ],
        globalVariables: [variable({ name: 'Uptime', type: { definition: 'base-type', value: 'DINT' } })],
      },
    },
  }
}

describe('projecting the store shape into the transpiler IR', () => {
  it('carries every POU, in every language the editor writes', () => {
    const ir = fromPortShape(fullProject())

    expect(ir.pous.map((p) => `${p.name}:${p.body.language}`)).toEqual([
      'Main:st',
      'Ladder:ld',
      'Blocks:fbd',
      'Compute:il',
      'Script:python',
      'Native:cpp',
      'Steps:st',
    ])
    expect(ir.pous[0].documentation).toBe('main program')
    expect(ir.pous[3].interface.returnType).toBe('INT')
    expect(ir.pous[4].interface.returnType).toBeUndefined()
  })

  it('projects each variable field only when it carries something', () => {
    const [main] = fromPortShape(fullProject()).pous
    const byName = new Map(main.interface.variables.map((v) => [v.name, v]))

    expect(byName.get('Start')).toEqual({
      name: 'Start',
      type: { definition: 'base-type', value: 'BOOL' },
      class: 'input',
      location: '%IX0.0',
      initialValue: 'FALSE',
      documentation: 'go',
    })
    expect(byName.get('Shared')?.class).toBe('local')
    expect(byName.get('Empty')).not.toHaveProperty('initialValue')
    expect(byName.get('Nulled')).not.toHaveProperty('initialValue')
    expect(byName.get('Drive')?.type).toEqual({ definition: 'derived', value: 'TON' })
    expect(byName.get('Engine')?.type).toEqual({ definition: 'user-data-type', value: 'Motor' })
    expect(byName.get('Samples')?.type).toEqual({
      definition: 'array',
      data: { dimensions: [{ dimension: '1..4' }], baseType: { value: 'INT' } },
    })
  })

  it('keeps the ladder graph, which is the only place a contact name lives', () => {
    const ladder = fromPortShape(fullProject()).pous[1].body

    expect(ladder.language).toBe('ld')
    if (ladder.language !== 'ld') return

    const [rung] = ladder.value.rungs
    expect(rung.id).toBe('rung-1')
    expect(rung.comment).toBe('start')
    expect(rung.reactFlowViewport).toEqual({ x: 0, y: 0, zoom: 1 })
    expect(rung.nodes.map((n) => n.id)).toEqual(['left-rail', 'contact-1', 'coil-1', 'right-rail'])
    expect(rung.nodes[1]).toEqual({
      id: 'contact-1',
      type: 'contact',
      position: { x: 100, y: 0 },
      data: { variable: { name: 'Start' } },
    })
    expect(rung.edges[0]).toEqual({
      id: 'e1',
      source: 'left-rail',
      target: 'contact-1',
      sourceHandle: 'a',
      targetHandle: 'b',
    })
    // An edge with no handles reports null, never undefined: the walker compares against null.
    expect(rung.edges[1]).toEqual({
      id: 'e2',
      source: 'contact-1',
      target: 'coil-1',
      sourceHandle: null,
      targetHandle: null,
    })
  })

  it('keeps the FBD graph as a single rung without a layout id', () => {
    const fbd = fromPortShape(fullProject()).pous[2].body

    expect(fbd.language).toBe('fbd')
    if (fbd.language !== 'fbd') return

    expect(fbd.value.rung).toEqual({
      comment: 'fbd',
      nodes: [{ id: 'n1', type: 'variable', position: { x: 1, y: 2 }, data: { variable: { name: 'Flag' } } }],
      edges: [{ id: 'e1', source: 'n1', target: 'n1', sourceHandle: null, targetHandle: null }],
    })
  })

  it('reads a graphical body it cannot understand as an empty graph rather than throwing', () => {
    const ir = fromPortShape({
      dataTypes: [],
      pous: [
        pou({ name: 'NoRungs', body: { language: 'ld', value: 'not a graph' } }),
        pou({ name: 'BadRung', body: { language: 'ld', value: { rungs: [null, { nodes: 'x', edges: 7 }] } } }),
        pou({
          name: 'BadNodes',
          body: {
            language: 'ld',
            value: { rungs: [{ id: 1, nodes: [null, { position: 'nowhere', data: [] }], edges: [null, { id: 3 }] }] },
          },
        }),
        pou({ name: 'NoRung', body: { language: 'fbd', value: { rung: [] } } }),
        pou({ name: 'NullBody', body: { language: 'st', value: null } }),
      ],
      configurations: EMPTY_RESOURCE,
    })

    const bodies = ir.pous.map((p) => p.body)

    expect(bodies[0]).toEqual({ language: 'ld', value: { rungs: [] } })
    expect(bodies[1]).toEqual({
      language: 'ld',
      value: {
        rungs: [
          { id: '', comment: '', reactFlowViewport: undefined, nodes: [], edges: [] },
          { id: '', comment: '', reactFlowViewport: undefined, nodes: [], edges: [] },
        ],
      },
    })
    expect(bodies[2]).toEqual({
      language: 'ld',
      value: {
        rungs: [
          {
            id: '',
            comment: '',
            reactFlowViewport: undefined,
            nodes: [
              { id: '', type: '', position: { x: 0, y: 0 }, data: {} },
              { id: '', type: '', position: { x: 0, y: 0 }, data: {} },
            ],
            edges: [
              { id: '', source: '', target: '', sourceHandle: null, targetHandle: null },
              { id: '', source: '', target: '', sourceHandle: null, targetHandle: null },
            ],
          },
        ],
      },
    })
    expect(bodies[3]).toEqual({ language: 'fbd', value: { rung: { comment: '', nodes: [], edges: [] } } })
    expect(bodies[4]).toEqual({ language: 'st', value: '' })
  })

  it('accepts the uppercase language tags the port still allows', () => {
    const ir = fromPortShape({
      dataTypes: [],
      pous: [
        pou({ name: 'A', body: { language: 'ST', value: 'x;' } }),
        pou({ name: 'B', body: { language: 'IL', value: 'LD x' } }),
        pou({ name: 'C', body: { language: 'LD', value: { rungs: [] } } }),
        pou({ name: 'D', body: { language: 'FBD', value: { rung: {} } } }),
        pou({ name: 'E', body: { language: 'SFC', value: 'y;' } }),
      ],
      configurations: EMPTY_RESOURCE,
    })

    expect(ir.pous.map((p) => p.body.language)).toEqual(['st', 'il', 'ld', 'fbd', 'st'])
  })

  it('projects data types into the scalar shapes the schema side uses', () => {
    const { dataTypes } = fromPortShape(fullProject())

    expect(dataTypes[0]).toEqual({
      name: 'Motor',
      derivation: 'structure',
      variable: [
        { name: 'speed', type: { definition: 'base-type', value: 'INT' }, initialValue: '10', documentation: 'rpm' },
        { name: 'running', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'empty', type: { definition: 'base-type', value: 'INT' } },
      ],
    })
    expect(dataTypes[1]).toEqual({
      name: 'Colour',
      derivation: 'enumerated',
      values: [{ description: 'RED' }],
      initialValue: 'RED',
    })
    expect(dataTypes[2]).toEqual({ name: 'Mode', derivation: 'enumerated', values: [{ description: 'AUTO' }] })
    expect(dataTypes[3]).toEqual({
      name: 'Readings',
      derivation: 'array',
      dimensions: [{ dimension: '1..2' }],
      baseType: { value: 'INT' },
      initialValue: '[0,0]',
    })
    // A nested array names its element type bare, exactly as the schema projection does.
    expect(dataTypes[4]).toEqual({
      name: 'Nested',
      derivation: 'array',
      dimensions: [{ dimension: '1..2' }],
      baseType: 'Readings',
    })
  })

  it('compiles each non-empty global variable list as a struct, an instance and an external', () => {
    const ir = fromPortShape(fullProject())

    expect(ir.dataTypes.slice(5)).toEqual([
      {
        name: 'GVL_TYPE',
        derivation: 'structure',
        variable: [{ name: 'Output1', type: { definition: 'base-type', value: 'BOOL' }, initialValue: 'TRUE' }],
      },
      {
        name: 'Unused_TYPE',
        derivation: 'structure',
        variable: [{ name: 'Spare', type: { definition: 'base-type', value: 'BOOL' }, initialValue: undefined }],
      },
    ])
    expect(ir.configuration.globalVariables.map((v) => v.name)).toEqual(['Uptime', 'GVL', 'Unused'])
    expect(ir.configuration.globalVariables[1]).toEqual({
      name: 'GVL',
      type: { definition: 'derived', value: 'GVL_TYPE' },
      location: '',
    })

    const externalsOf = (name: string) =>
      ir.pous
        .find((p) => p.name === name)
        ?.interface.variables.filter((v) => v.class === 'external')
        .map((v) => v.name)

    // Referenced in ST text and inside a ladder coil's variable name alike.
    expect(externalsOf('Main')).toEqual(['GVL'])
    expect(externalsOf('Ladder')).toEqual(['GVL'])
    expect(externalsOf('Blocks')).toEqual([])
  })

  it('projects the resource, telling a cyclic task from an interrupt one', () => {
    const { configuration } = fromPortShape(fullProject())

    expect(configuration.tasks).toEqual([
      { name: 'Fast', priority: 0, triggering: 'Cyclic', interval: 'T#20ms' },
      { name: 'OnEdge', priority: 1, triggering: 'Interrupt', single: 'T#0ms' },
    ])
    expect(configuration.instances).toEqual([
      { name: 'inst0', program: 'Main', task: 'Fast' },
      { name: 'inst1', program: 'Ladder' },
    ])
  })

  it('projects a project with nothing in it', () => {
    expect(fromPortShape({ dataTypes: [], pous: [], configurations: EMPTY_RESOURCE })).toEqual({
      pous: [],
      dataTypes: [],
      configuration: { tasks: [], instances: [], globalVariables: [] },
    })
  })
})
