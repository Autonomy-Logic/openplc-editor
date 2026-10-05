/**
 * `buildFbdGraph` is the seam a headless caller goes through to get the diagram
 * the editor would have drawn, and none of it was covered.
 *
 * The node BUILDER is mocked, not because mocking is convenient but because
 * importing it pulls the whole editor component tree in behind it — autocomplete
 * → the ST language service → `vscode-languageserver-protocol`, which ships ESM
 * that this jest config does not transform. The CLI's own tests mock
 * `apply/fbd` for the same reason.
 *
 * So what is under test here is this module's own work: where nodes land, which
 * handle a pin reference resolves to, the exact edge id, and what it does with
 * input it cannot use. The stand-in mirrors the real builder's one contract that
 * matters to this file — a known kind yields a node with a `data` object, an
 * unknown kind yields `undefined`.
 */

import type { Edge, Node } from '@xyflow/react'

jest.mock('../../../../../components/_molecules/graphical-editor/fbd/fbd-utils/nodes', () => ({
  buildGenericNode: ({ id, position, nodeType }: { id: string; position: unknown; nodeType: string }) =>
    ['block', 'input-variable', 'output-variable', 'inout-variable', 'comment', 'connector', 'continuation'].includes(
      nodeType,
    )
      ? { id, position, type: nodeType, data: {} }
      : undefined,
}))

import { buildFbdGraph, splitPinRef } from '../build-graph'

const AND: unknown = { name: 'AND', type: 'function' }

const build = (nodes: Parameters<typeof buildFbdGraph>[0], connections: Parameters<typeof buildFbdGraph>[1] = []) =>
  buildFbdGraph(nodes, connections)

describe('splitPinRef', () => {
  it('reads a bare label as a whole node', () => {
    expect(splitPinRef('start')).toEqual({ label: 'start' })
  })

  it('splits a pin reference at the first dot', () => {
    expect(splitPinRef('gate.IN1')).toEqual({ label: 'gate', pin: 'IN1' })
  })

  it('keeps later dots in the pin, which is how a member path arrives', () => {
    expect(splitPinRef('gate.Cfg.MinLevel')).toEqual({ label: 'gate', pin: 'Cfg.MinLevel' })
  })
})

describe('building a graph', () => {
  it('places every node and gives each one its own id', () => {
    const result = build([
      { label: 'start', kind: 'input-variable', variable: 'gStart' },
      { label: 'gate', kind: 'block', variant: AND },
      { label: 'pump', kind: 'output-variable', variable: 'gPump' },
    ])

    expect(result.errors).toEqual([])
    expect(result.nodes).toHaveLength(3)
    expect(new Set(result.nodes.map((node) => node.id)).size).toBe(3)
  })

  it('lays the graph out along signal flow', () => {
    const result = build(
      [
        { label: 'start', kind: 'input-variable', variable: 'gStart' },
        { label: 'gate', kind: 'block', variant: AND },
        { label: 'pump', kind: 'output-variable', variable: 'gPump' },
      ],
      [
        { from: 'start', to: 'gate.IN1' },
        { from: 'gate.OUT', to: 'pump' },
      ],
    )

    const [start, gate, pump] = result.nodes as Node[]
    expect(start.position.x).toBeLessThan(gate.position.x)
    expect(gate.position.x).toBeLessThan(pump.position.x)
  })

  it('carries the variable name onto a variable node', () => {
    const result = build([{ label: 'start', kind: 'input-variable', variable: 'gStart' }])
    expect((result.nodes[0].data as { variable?: { name: string } }).variable?.name).toBe('gStart')
  })

  it('carries a comment body and an execution order', () => {
    const result = build([
      { label: 'note', kind: 'comment', text: 'why this rung exists' },
      { label: 'gate', kind: 'block', variant: AND, executionOrder: 3 },
    ])

    expect((result.nodes[0].data as { value?: string }).value).toBe('why this rung exists')
    expect((result.nodes[1].data as { executionOrder?: number }).executionOrder).toBe(3)
  })
})

describe('wiring', () => {
  const wired = () =>
    build(
      [
        { label: 'start', kind: 'input-variable', variable: 'gStart' },
        { label: 'gate', kind: 'block', variant: AND },
        { label: 'pump', kind: 'output-variable', variable: 'gPump' },
      ],
      [
        { from: 'start', to: 'gate.IN1' },
        { from: 'gate.OUT', to: 'pump' },
      ],
    )

  it('uses the pin name as the handle on a block, and the fixed handle on a variable', () => {
    const [toGate, toPump] = wired().edges
    expect(toGate.targetHandle).toBe('IN1')
    expect(toGate.sourceHandle).toBe('output-variable')
    expect(toPump.sourceHandle).toBe('OUT')
    expect(toPump.targetHandle).toBe('input-variable')
  })

  it('mints the edge id React Flow and the XML parser both expect', () => {
    // `xy-edge__<source><sourceHandle>-<target><targetHandle>` — a different
    // shape loads as a diagram with no wires rather than as an error.
    const edge = wired().edges[0] as Edge
    expect(edge.id).toBe(`xy-edge__${edge.source}${edge.sourceHandle}-${edge.target}${edge.targetHandle}`)
    expect(edge.id.startsWith('xy-edge__')).toBe(true)
  })

  it('reports a connection naming a node that is not there, and drops only that edge', () => {
    const result = build(
      [
        { label: 'start', kind: 'input-variable', variable: 'gStart' },
        { label: 'gate', kind: 'block', variant: AND },
      ],
      [
        { from: 'start', to: 'gate.IN1' },
        { from: 'gate.OUT', to: 'ghost' },
      ],
    )

    expect(result.edges).toHaveLength(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('unknown node')
  })

  it('reports a node kind it cannot build, and keeps the rest', () => {
    const result = build([
      { label: 'start', kind: 'input-variable', variable: 'gStart' },
      { label: 'odd', kind: 'not-a-kind' as never },
    ])

    expect(result.nodes).toHaveLength(1)
    expect(result.errors[0]).toContain('unknown kind')
  })

  it('reports the cycles the layout had to break, keeping both edges', () => {
    // Layout is not policy: it cannot rank a cycle, so it reports which
    // connection it ignored rather than looping forever, and leaves both edges
    // alone. Refusing the diagram is `apply/fbd`'s job — FBD has no feedback
    // within one diagram.
    const result = build(
      [
        { label: 'a', kind: 'block', variant: AND },
        { label: 'b', kind: 'block', variant: AND },
      ],
      [
        { from: 'a.OUT', to: 'b.IN1' },
        { from: 'b.OUT', to: 'a.IN1' },
      ],
    )

    expect(result.brokenCycles).toHaveLength(1)
    expect(result.edges).toHaveLength(2)
  })
})
