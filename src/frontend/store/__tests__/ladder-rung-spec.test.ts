import type { Node } from '@xyflow/react'

import type { PLCVariable } from '../../../middleware/shared/ports/types'
import type { BlockVariant } from '../../components/_atoms/graphical-editor/ladder/utils/types'
import type { RungLadderState } from '../slices/ladder/types'
import { buildRungFromSpec, rungToSpec, type RungSpec } from '../slices/ladder/utils/rung-spec'

const makeVariable = (name: string, type = 'bool'): PLCVariable => ({
  name,
  class: 'local',
  type: { definition: 'base-type', value: type },
  location: '',
  documentation: '',
})

const makeInstance = (name: string, blockType: string): PLCVariable => ({
  name,
  class: 'local',
  type: { definition: 'derived', value: blockType },
  location: '',
  documentation: '',
})

/** IN/Q both BOOL — no EN/ENO auto-injection, matching the plan's own TON example. */
const tonVariant: BlockVariant = {
  name: 'TON',
  type: 'function-block',
  documentation: '',
  extensible: false,
  variables: [
    { name: 'IN', class: 'input', type: { definition: 'base-type', value: 'bool' } },
    { name: 'PT', class: 'input', type: { definition: 'base-type', value: 'time' } },
    { name: 'Q', class: 'output', type: { definition: 'base-type', value: 'bool' } },
    { name: 'ET', class: 'output', type: { definition: 'base-type', value: 'time' } },
  ],
}

/** DINT pins force EN/ENO auto-injection — exercises the rail-connector shift. */
const addVariant: BlockVariant = {
  name: 'ADD',
  type: 'function',
  documentation: '',
  extensible: true,
  variables: [
    { name: 'IN1', class: 'input', type: { definition: 'base-type', value: 'dint' } },
    { name: 'IN2', class: 'input', type: { definition: 'base-type', value: 'dint' } },
    { name: 'OUT', class: 'output', type: { definition: 'base-type', value: 'dint' } },
  ],
}

/** Carries an inOut pin (rejected in Phase 1) alongside a plain rail pin. */
const ioVariant: BlockVariant = {
  name: 'IOBLOCK',
  type: 'function-block',
  documentation: '',
  extensible: false,
  variables: [
    { name: 'IN', class: 'input', type: { definition: 'base-type', value: 'bool' } },
    { name: 'IO', class: 'inOut', type: { definition: 'base-type', value: 'bool' } },
    { name: 'Q', class: 'output', type: { definition: 'base-type', value: 'bool' } },
    { name: 'Q2', class: 'output', type: { definition: 'base-type', value: 'bool' } },
  ],
}

const BLOCKS: Record<string, BlockVariant> = { TON: tonVariant, ADD: addVariant, IOBLOCK: ioVariant }
const resolveBlock = (name: string): BlockVariant | undefined => BLOCKS[name]

describe('buildRungFromSpec', () => {
  it('builds a bare rung when the spec has no elements', () => {
    const result = buildRungFromSpec({ rungId: 'r1', spec: { elements: [] }, variables: [], resolveBlock })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rung.nodes.map((n) => n.type)).toEqual(['powerRail', 'powerRail'])
    expect(result.rung.selectedNodes).toEqual([])
    expect(result.rung.nodes.every((n) => n.selected === false)).toBe(true)
    expect(result.rung.defaultBounds).toEqual([300, 100])
  })

  it('respects a custom defaultBounds', () => {
    const result = buildRungFromSpec({
      rungId: 'r1',
      spec: { elements: [] },
      variables: [],
      resolveBlock,
      defaultBounds: [600, 200],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rung.defaultBounds).toEqual([600, 200])
  })

  it('builds a contact bound to an existing variable, defaulting variant', () => {
    const start = makeVariable('Start')
    const result = buildRungFromSpec({
      rungId: 'r1',
      spec: { elements: [{ kind: 'contact', variable: 'start' }] },
      variables: [start],
      resolveBlock,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const contact = result.rung.nodes.find((n) => n.type === 'contact')
    expect((contact?.data as { variable: PLCVariable }).variable.name).toBe('Start')
    expect((contact?.data as { variant: string }).variant).toBe('default')
    expect(contact?.selected).toBe(false)
  })

  it('builds a contact with an explicit variant', () => {
    const stop = makeVariable('Stop')
    const result = buildRungFromSpec({
      rungId: 'r1',
      spec: { elements: [{ kind: 'contact', variable: 'Stop', variant: 'negated' }] },
      variables: [stop],
      resolveBlock,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const contact = result.rung.nodes.find((n) => n.type === 'contact')
    expect((contact?.data as { variant: string }).variant).toBe('negated')
  })

  it('builds a coil bound to an existing variable', () => {
    const motor = makeVariable('Motor')
    const result = buildRungFromSpec({
      rungId: 'r1',
      spec: { elements: [{ kind: 'coil', variable: 'Motor', variant: 'set' }] },
      variables: [motor],
      resolveBlock,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const coil = result.rung.nodes.find((n) => n.type === 'coil')
    expect((coil?.data as { variable: PLCVariable }).variable.name).toBe('Motor')
    expect((coil?.data as { variant: string }).variant).toBe('set')
  })

  it('wires a series chain left-to-right and positions elements accordingly', () => {
    const start = makeVariable('Start')
    const motor = makeVariable('Motor')
    const result = buildRungFromSpec({
      rungId: 'r1',
      spec: {
        elements: [
          { kind: 'contact', variable: 'Start' },
          { kind: 'coil', variable: 'Motor' },
        ],
      },
      variables: [start, motor],
      resolveBlock,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const leftRail = result.rung.nodes.find((n) => n.id.startsWith('left-rail'))
    const contact = result.rung.nodes.find((n) => n.type === 'contact')
    const coil = result.rung.nodes.find((n) => n.type === 'coil')
    const rightRail = result.rung.nodes.find((n) => n.id.startsWith('right-rail'))

    expect(leftRail!.position.x).toBeLessThan(contact!.position.x)
    expect(contact!.position.x).toBeLessThan(coil!.position.x)
    expect(coil!.position.x).toBeLessThan(rightRail!.position.x)
    expect(result.rung.reactFlowViewport[0]).toBeGreaterThanOrEqual(result.rung.defaultBounds[0])
    expect(result.rung.reactFlowViewport[1]).toBeGreaterThan(result.rung.defaultBounds[1])
  })

  it('fails with a listed error when a contact variable does not exist', () => {
    const result = buildRungFromSpec({
      rungId: 'r1',
      spec: { elements: [{ kind: 'contact', variable: 'Nope' }] },
      variables: [],
      resolveBlock,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]).toMatch(/variable "Nope" not found/)
  })

  it('fails with a listed error when a coil variable does not exist', () => {
    const result = buildRungFromSpec({
      rungId: 'r1',
      spec: { elements: [{ kind: 'coil', variable: 'Nope' }] },
      variables: [],
      resolveBlock,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]).toMatch(/variable "Nope" not found/)
  })

  it('fails when a block type does not resolve', () => {
    const result = buildRungFromSpec({
      rungId: 'r1',
      spec: { elements: [{ kind: 'block', blockType: 'MISSING' }] },
      variables: [],
      resolveBlock,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]).toMatch(/block type "MISSING" not found/)
  })

  it('requires instanceName for function-block types', () => {
    const result = buildRungFromSpec({
      rungId: 'r1',
      spec: { elements: [{ kind: 'block', blockType: 'TON' }] },
      variables: [],
      resolveBlock,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]).toMatch(/requires "instanceName"/)
  })

  it('fails when the instance variable does not exist', () => {
    const result = buildRungFromSpec({
      rungId: 'r1',
      spec: { elements: [{ kind: 'block', blockType: 'TON', instanceName: 'Ghost' }] },
      variables: [],
      resolveBlock,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]).toMatch(/instance variable "Ghost" not found/)
  })

  it('builds a function-block instance with pin bindings', () => {
    const instance = makeInstance('Timer1', 'TON')
    const preset = makeVariable('Preset', 'time')
    const elapsed = makeVariable('Elapsed', 'time')
    const result = buildRungFromSpec({
      rungId: 'r1',
      spec: {
        elements: [
          {
            kind: 'block',
            blockType: 'TON',
            instanceName: 'Timer1',
            pins: [
              { pin: 'PT', variable: 'Preset' },
              { pin: 'ET', variable: 'Elapsed' },
            ],
          },
        ],
      },
      variables: [instance, preset, elapsed],
      resolveBlock,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const block = result.rung.nodes.find((n) => n.type === 'block')
    const data = block?.data as {
      variable: PLCVariable
      connectedVariables: Array<{ handleId: string; type: string; variable: PLCVariable }>
    }
    expect(data.variable.name).toBe('Timer1')
    expect(data.connectedVariables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ handleId: 'PT', type: 'input', variable: preset }),
        expect.objectContaining({ handleId: 'ET', type: 'output', variable: elapsed }),
      ]),
    )
  })

  it('binds no pins when the spec omits them', () => {
    const instance = makeInstance('Timer2', 'TON')
    const result = buildRungFromSpec({
      rungId: 'r1',
      spec: { elements: [{ kind: 'block', blockType: 'TON', instanceName: 'Timer2' }] },
      variables: [instance],
      resolveBlock,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const block = result.rung.nodes.find((n) => n.type === 'block')
    expect((block?.data as { connectedVariables: unknown[] }).connectedVariables).toEqual([])
  })

  it('builds a non-function-block without an instance variable, EN/ENO auto-injected', () => {
    const a = makeVariable('A', 'dint')
    const b = makeVariable('B', 'dint')
    const sum = makeVariable('Sum', 'dint')
    const result = buildRungFromSpec({
      rungId: 'r1',
      spec: {
        elements: [
          {
            kind: 'block',
            blockType: 'ADD',
            pins: [
              { pin: 'IN1', variable: 'A' },
              { pin: 'IN2', variable: 'B' },
              { pin: 'OUT', variable: 'Sum' },
            ],
          },
        ],
      },
      variables: [a, b, sum],
      resolveBlock,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const block = result.rung.nodes.find((n) => n.type === 'block')
    const data = block?.data as {
      variable: { name: string }
      connectedVariables: Array<{ handleId: string; type: string }>
    }
    expect(data.variable.name).toBe('')
    expect(data.connectedVariables.map((cv) => cv.handleId).sort()).toEqual(['IN1', 'IN2', 'OUT'])
    expect(data.connectedVariables.find((cv) => cv.handleId === 'IN1')?.type).toBe('input')
    expect(data.connectedVariables.find((cv) => cv.handleId === 'OUT')?.type).toBe('output')
  })

  it('collects every pin error in one pass: inOut, rail connector, unknown pin, unresolved variable', () => {
    const instance = makeInstance('Io1', 'IOBLOCK')
    const someVar = makeVariable('SomeVar', 'bool')
    const result = buildRungFromSpec({
      rungId: 'r1',
      spec: {
        elements: [
          {
            kind: 'block',
            blockType: 'IOBLOCK',
            instanceName: 'Io1',
            pins: [
              { pin: 'IO', variable: 'SomeVar' },
              { pin: 'IN', variable: 'SomeVar' },
              { pin: 'GHOST', variable: 'SomeVar' },
              { pin: 'Q2', variable: 'Missing' },
            ],
          },
        ],
      },
      variables: [instance, someVar],
      resolveBlock,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors).toHaveLength(4)
    expect(result.errors[0]).toMatch(/pin "IO".*inOut/)
    expect(result.errors[1]).toMatch(/pin "IN".*rail connector/)
    expect(result.errors[2]).toMatch(/pin "GHOST".*does not exist/)
    expect(result.errors[3]).toMatch(/variable "Missing" not found for pin "Q2"/)
  })
})

describe('rungToSpec', () => {
  it('round-trips a series rung built from a spec', () => {
    const start = makeVariable('Start')
    const stop = makeVariable('Stop')
    const motor = makeVariable('Motor')
    const inputSpec: RungSpec = {
      comment: 'seal-in circuit',
      elements: [
        { kind: 'contact', variable: 'Start', variant: 'default' },
        { kind: 'contact', variable: 'Stop', variant: 'negated' },
        { kind: 'coil', variable: 'Motor', variant: 'default' },
      ],
    }
    const built = buildRungFromSpec({ rungId: 'r1', spec: inputSpec, variables: [start, stop, motor], resolveBlock })
    expect(built.ok).toBe(true)
    if (!built.ok) return

    const spec = rungToSpec(built.rung)
    expect(spec.comment).toBe('seal-in circuit')
    expect(spec.truncated).toBeUndefined()
    expect(spec.elements).toEqual(inputSpec.elements)
  })

  it('round-trips a block element with an instance name and pin bindings', () => {
    const instance = makeInstance('Timer1', 'TON')
    const preset = makeVariable('Preset', 'time')
    const inputSpec: RungSpec = {
      elements: [
        { kind: 'block', blockType: 'TON', instanceName: 'Timer1', pins: [{ pin: 'PT', variable: 'Preset' }] },
      ],
    }
    const built = buildRungFromSpec({ rungId: 'r1', spec: inputSpec, variables: [instance, preset], resolveBlock })
    expect(built.ok).toBe(true)
    if (!built.ok) return

    const spec = rungToSpec(built.rung)
    expect(spec.elements).toEqual(inputSpec.elements)
  })

  it('returns an empty spec when the rung has no left rail', () => {
    const rung: RungLadderState = {
      id: 'r1',
      comment: '',
      defaultBounds: [300, 100],
      reactFlowViewport: [300, 100],
      selectedNodes: [],
      nodes: [],
      edges: [],
    }

    expect(rungToSpec(rung)).toEqual({ comment: '', elements: [] })
  })

  it('stops the walk when the left rail has no outgoing edge', () => {
    const start = makeVariable('Start')
    const built = buildRungFromSpec({
      rungId: 'r1',
      spec: { elements: [{ kind: 'contact', variable: 'Start' }] },
      variables: [start],
      resolveBlock,
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return

    const rungWithoutEdges: RungLadderState = { ...built.rung, edges: [] }
    expect(rungToSpec(rungWithoutEdges)).toEqual({ comment: built.rung.comment, elements: [] })
  })

  it('stops the walk when an edge target node is missing', () => {
    const rung: RungLadderState = {
      id: 'r1',
      comment: '',
      defaultBounds: [300, 100],
      reactFlowViewport: [300, 100],
      selectedNodes: [],
      nodes: [
        {
          id: 'left-rail-r1',
          type: 'powerRail',
          position: { x: 0, y: 0 },
          data: { outputConnector: { id: 'left-rail' } },
        },
      ],
      edges: [{ id: 'e1', source: 'left-rail-r1', target: 'ghost', sourceHandle: 'left-rail', targetHandle: 'input' }],
    }

    expect(rungToSpec(rung)).toEqual({ comment: '', elements: [] })
  })

  it('marks the spec truncated when a parallel branch is present', () => {
    const start = makeVariable('Start')
    const built = buildRungFromSpec({
      rungId: 'r1',
      spec: { elements: [{ kind: 'contact', variable: 'Start' }] },
      variables: [start],
      resolveBlock,
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return

    const leftRail = built.rung.nodes.find((n) => n.id.startsWith('left-rail'))!
    const leftRailOutput = (leftRail.data as { outputConnector?: { id?: string } }).outputConnector?.id
    const parallelNode: Node = { id: 'parallel-1', type: 'parallel', position: { x: 0, y: 0 }, data: {} }

    const rungWithParallel: RungLadderState = {
      ...built.rung,
      nodes: [...built.rung.nodes, parallelNode],
      edges: [
        ...built.rung.edges.filter((e) => e.source !== leftRail.id),
        { id: 'e_new', source: leftRail.id, target: parallelNode.id, sourceHandle: leftRailOutput, targetHandle: 'x' },
      ],
    }

    const spec = rungToSpec(rungWithParallel)
    expect(spec.truncated).toBe(true)
    expect(spec.elements).toEqual([])
  })
})
