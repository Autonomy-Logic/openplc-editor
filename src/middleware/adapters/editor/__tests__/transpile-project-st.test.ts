/**
 * The desktop's ST context for the assistant.
 *
 * Two things are being proved. First, that the port-shape project the store holds is
 * projected into the transpiler's IR without losing anything the model needs — a graphical
 * POU that arrives as a React Flow graph and nothing else is a program the assistant
 * cannot read, and there is no error anywhere when that happens: the answers just quietly
 * stop being about the user's program. Second, that the whole thing NEVER throws. It is
 * called from a chat turn, and a transpiler that raised would take the answer down with
 * it; `null` means "no ST for this diagram", which every caller already handles.
 */

import type { PLCProjectData, PLCPou, PLCVariable } from '../../../shared/ports/types'
import { fromPortShape } from '../transpile-from-port'
import { transpileProjectStInProcess } from '../transpile-project-st'

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
        { id: 'coil-1', type: 'coil', position: { x: 200, y: 0 }, data: { variable: { name: 'Motor' } } },
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
          // No initial value and no documentation: the optional-field branches.
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
      pou({
        name: 'Script',
        interface: { variables: [variable({ name: 'flag' })] },
        body: { language: 'python', value: 'pass' },
      }),
      pou({
        name: 'Native',
        interface: { variables: [variable({ name: 'flag' })] },
        body: { language: 'cpp', value: '// c++' },
      }),
      // Not ported yet: falls back to ST passthrough rather than crashing a fixture.
      pou({
        name: 'Steps',
        interface: { variables: [variable({ name: 'flag' })] },
        body: { language: 'sfc', value: 'flag := TRUE;' },
      }),
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
      // SFC is not ported: passthrough as ST rather than a crash mid-chat.
      'Steps:st',
    ])
    expect(ir.pous[3].interface.returnType).toBe('INT')
  })

  it('keeps the ladder graph, which is the only place a contact name lives', () => {
    const ir = fromPortShape(fullProject())
    const ladder = ir.pous[1].body

    expect(ladder.language).toBe('ld')
    if (ladder.language !== 'ld') return

    expect(ladder.value.rungs).toHaveLength(1)
    expect(ladder.value.rungs[0].nodes.map((n) => n.type)).toEqual(['powerRail', 'contact', 'coil', 'powerRail'])
    expect(ladder.value.rungs[0].edges[0]).toEqual({
      id: 'e1',
      source: 'left-rail',
      target: 'contact-1',
      sourceHandle: 'a',
      targetHandle: 'b',
    })
    // Absent handles become null rather than undefined: the walker reads them positionally.
    expect(ladder.value.rungs[0].edges[1].sourceHandle).toBeNull()
  })

  it('keeps the FBD graph', () => {
    const ir = fromPortShape(fullProject())
    const fbd = ir.pous[2].body

    expect(fbd.language).toBe('fbd')
    if (fbd.language !== 'fbd') return

    expect(fbd.value.rung.comment).toBe('fbd')
    expect(fbd.value.rung.nodes[0].position).toEqual({ x: 1, y: 2 })
  })

  it('falls back on a node the store left half-written rather than dropping the rung', () => {
    const project = fullProject()

    project.pous[1] = pou({
      name: 'Ladder',
      body: {
        language: 'ld',
        value: {
          rungs: [{ nodes: [{ id: 7, type: null, data: ['not a record'] }], edges: [{ id: null }] }],
        },
      },
    })

    const ir = fromPortShape(project)
    const ladder = ir.pous[1].body

    if (ladder.language !== 'ld') throw new Error('expected a ladder body')

    expect(ladder.value.rungs[0].id).toBe('')
    expect(ladder.value.rungs[0].nodes[0]).toEqual({ id: '', type: '', position: { x: 0, y: 0 }, data: {} })
    expect(ladder.value.rungs[0].edges[0]).toEqual({
      id: '',
      source: '',
      target: '',
      sourceHandle: null,
      targetHandle: null,
    })
  })

  it('turns each Global Variable List into a struct, an instance and a VAR_EXTERNAL', () => {
    const ir = fromPortShape(fullProject())

    // The empty list is dropped: an empty STRUCT is not a legal type.
    expect(ir.dataTypes.map((d) => d.name)).toEqual([
      'Motor',
      'Colour',
      'Mode',
      'Readings',
      'Nested',
      'GVL_TYPE',
      'Unused_TYPE',
    ])
    expect(ir.configuration.globalVariables.map((v) => v.name)).toEqual(['Uptime', 'GVL', 'Unused'])

    // Only the POU that mentions `GVL.` gains the external; without it STruC++ answers
    // "Undeclared variable 'GVL'".
    expect(ir.pous[0].interface.variables.map((v) => v.name)).toContain('GVL')
    expect(ir.pous[0].interface.variables.map((v) => v.name)).not.toContain('Unused')
    expect(ir.pous[1].interface.variables).toHaveLength(0)
  })

  it('projects every variable-type definition and drops the empty optionals', () => {
    const ir = fromPortShape(fullProject())
    const byName = new Map(ir.pous[0].interface.variables.map((v) => [v.name, v]))

    expect(byName.get('Start')).toEqual({
      name: 'Start',
      type: { definition: 'base-type', value: 'BOOL' },
      class: 'input',
      location: '%IX0.0',
      initialValue: 'FALSE',
      documentation: 'go',
    })
    // 'global' has no IR equivalent; it is folded onto 'local'.
    expect(byName.get('Shared')?.class).toBe('local')
    expect(byName.get('Empty')).not.toHaveProperty('initialValue')
    expect(byName.get('Nulled')).not.toHaveProperty('initialValue')
    expect(byName.get('Motor')).not.toHaveProperty('location')
    expect(byName.get('Drive')?.type).toEqual({ definition: 'derived', value: 'TON' })
    expect(byName.get('Engine')?.type).toEqual({ definition: 'user-data-type', value: 'Motor' })
    expect(byName.get('Samples')?.type).toEqual({
      definition: 'array',
      data: { baseType: { value: 'INT' }, dimensions: [{ dimension: '1..4' }] },
    })
  })

  it('projects structures, enumerations and arrays', () => {
    const ir = fromPortShape(fullProject())

    expect(ir.dataTypes[0]).toEqual({
      name: 'Motor',
      derivation: 'structure',
      variable: [
        { name: 'speed', type: { definition: 'base-type', value: 'INT' }, initialValue: '10', documentation: 'rpm' },
        { name: 'running', type: { definition: 'base-type', value: 'BOOL' } },
        { name: 'empty', type: { definition: 'base-type', value: 'INT' } },
      ],
    })
    expect(ir.dataTypes[1]).toEqual({
      name: 'Colour',
      derivation: 'enumerated',
      values: [{ description: 'RED' }],
      initialValue: 'RED',
    })
    expect(ir.dataTypes[2]).not.toHaveProperty('initialValue')
    expect(ir.dataTypes[3]).toEqual({
      name: 'Readings',
      derivation: 'array',
      dimensions: [{ dimension: '1..2' }],
      baseType: { value: 'INT' },
      initialValue: '[0,0]',
    })
    // An array of an array collapses to the elementary tag rather than a wrapper.
    expect(ir.dataTypes[4]).toMatchObject({ baseType: 'Readings' })
  })

  it('keeps a task interval on the field its triggering mode names', () => {
    const ir = fromPortShape(fullProject())

    expect(ir.configuration.tasks).toEqual([
      { name: 'Fast', priority: 0, triggering: 'Cyclic', interval: 'T#20ms' },
      { name: 'OnEdge', priority: 1, triggering: 'Interrupt', single: 'T#0ms' },
    ])
    expect(ir.configuration.instances).toEqual([
      { name: 'inst0', program: 'Main', task: 'Fast' },
      { name: 'inst1', program: 'Ladder' },
    ])
  })

  it('reads an unknown body language as ST rather than refusing the project', () => {
    const ir = fromPortShape({
      dataTypes: [],
      pous: [pou({ name: 'Legacy', body: { language: 'ST', value: 'x := 1;' } })],
      configurations: { resource: { tasks: [], instances: [], globalVariables: [] } },
    })

    expect(ir.pous[0].body).toEqual({ language: 'st', value: 'x := 1;' })
  })

  it('survives a project with nothing in it', () => {
    const ir = fromPortShape({
      dataTypes: [],
      pous: [],
      configurations: { resource: { tasks: [], instances: [], globalVariables: [] } },
    })

    expect(ir).toEqual({ pous: [], dataTypes: [], configuration: { tasks: [], instances: [], globalVariables: [] } })
  })
})

describe('the transpiler the chat panel is handed', () => {
  it('answers with the same Structured Text the compile path emits', async () => {
    const programSt = await transpileProjectStInProcess(fullProject())

    expect(programSt).toContain('PROGRAM Main')
    // The ladder POU reached the model as ST, which is the whole point of wiring this in.
    expect(programSt).toContain('PROGRAM Ladder')
    expect(programSt).toContain('CONFIGURATION')
  })

  it('answers null — never throws — when a POU cannot be compiled', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)

    // A Python POU with no declared variables: the transpiler collects this as a per-POU
    // error rather than throwing, and a partial program is not context the model should
    // be answering from.
    const broken = await transpileProjectStInProcess({
      dataTypes: [],
      pous: [pou({ name: 'Broken', body: { language: 'python', value: 'pass' } })],
      configurations: { resource: { tasks: [], instances: [], globalVariables: [] } },
    })

    expect(broken).toBeNull()
    expect(warn).toHaveBeenCalled()

    warn.mockRestore()
  })

  it('answers null when the projection itself blows up on a malformed body', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)

    // A ladder body with no `rungs` at all: the projection reads straight through it, so
    // this is the throwing path rather than the error-collecting one.
    const result = await transpileProjectStInProcess({
      dataTypes: [],
      pous: [pou({ name: 'Broken', body: { language: 'ld', value: null } })],
      configurations: { resource: { tasks: [], instances: [], globalVariables: [] } },
    })

    expect(result).toBeNull()
    expect(warn).toHaveBeenCalled()

    warn.mockRestore()
  })
})
