import type { Node } from '@xyflow/react'

import { needsPositionRecovery } from '../../slice'
import { buildLadderRung, type RungLogic } from '../build-rung'

// A rung built from a description carries no geometry. That is the contract
// with `addLadderFlow`, which runs the editor's real layout solver over any
// rung where `needsPositionRecovery` fires — and that predicate keys on an
// element sitting at the origin. Emitting no `position` at all would NOT
// trigger it, so these tests pin the origin rather than the absence.

const contact = (variable: string): RungLogic => ({ contact: { variable, variant: 'default' } })
const coil = (variable: string) => ({ coil: { variable, variant: 'default' as const } })

const nodesOfType = (nodes: Node[], type: string) => nodes.filter((node) => node.type === type)

describe('buildLadderRung — shape', () => {
  it('brackets the rung with a left and right rail the store can find', () => {
    // `setRungs` silently does nothing unless the ids start this way.
    const rung = buildLadderRung({ rungId: 'r1', outputs: [coil('Run')] })

    expect(rung.nodes[0].id).toBe('left-rail-r1')
    expect(rung.nodes[rung.nodes.length - 1].id).toBe('right-rail-r1')
  })

  it('wires a single contact between the rails', () => {
    const rung = buildLadderRung({ rungId: 'r1', logic: contact('Start'), outputs: [coil('Run')] })

    expect(nodesOfType(rung.nodes as Node[], 'contact')).toHaveLength(1)
    expect(nodesOfType(rung.nodes as Node[], 'coil')).toHaveLength(1)
    // rail -> contact -> coil -> rail
    expect(rung.edges).toHaveLength(3)
  })

  it('carries the variable names onto the nodes', () => {
    const rung = buildLadderRung({ rungId: 'r1', logic: contact('Start'), outputs: [coil('Run')] })
    const names = (rung.nodes as Node[])
      .filter((node) => node.type === 'contact' || node.type === 'coil')
      .map((node) => (node.data as { variable: { name: string } }).variable.name)

    expect(names).toEqual(['Start', 'Run'])
  })

  it('chains a series left to right', () => {
    const rung = buildLadderRung({
      rungId: 'r1',
      logic: { series: [contact('A'), contact('B'), contact('C')] },
      outputs: [coil('Run')],
    })

    expect(nodesOfType(rung.nodes as Node[], 'contact')).toHaveLength(3)
    // rail->A, A->B, B->C, C->coil, coil->rail
    expect(rung.edges).toHaveLength(5)
  })
})

describe('buildLadderRung — parallels', () => {
  it('brackets two branches with a linked OPEN/CLOSE pair', () => {
    const rung = buildLadderRung({
      rungId: 'r1',
      logic: { parallel: [contact('Start'), contact('Run')] },
      outputs: [coil('Run')],
    })

    const parallels = nodesOfType(rung.nodes as Node[], 'parallel')
    expect(parallels).toHaveLength(2)

    const open = parallels.find((node) => (node.data as { type: string }).type === 'open')
    const close = parallels.find((node) => (node.data as { type: string }).type === 'close')
    // The pair is found by id at layout time; an unlinked pair lays out wrong.
    expect((open?.data as { parallelCloseReference?: string }).parallelCloseReference).toBe(close?.id)
    expect((close?.data as { parallelOpenReference?: string }).parallelOpenReference).toBe(open?.id)
  })

  it('routes one branch straight through and the other down', () => {
    const rung = buildLadderRung({
      rungId: 'r1',
      logic: { parallel: [contact('A'), contact('B')] },
      outputs: [coil('Run')],
    })

    const handles = rung.edges.map((edge) => `${edge.sourceHandle}->${edge.targetHandle}`)
    expect(handles).toContain('output-right->input')
    expect(handles).toContain('output-down->input')
    expect(handles).toContain('output->input-down')
  })

  it('nests three or more branches, since a pair carries only two', () => {
    const rung = buildLadderRung({
      rungId: 'r1',
      logic: { parallel: [contact('A'), contact('B'), contact('C')] },
      outputs: [coil('Run')],
    })

    expect(nodesOfType(rung.nodes as Node[], 'parallel')).toHaveLength(4)
    expect(nodesOfType(rung.nodes as Node[], 'contact')).toHaveLength(3)
  })
})

describe('buildLadderRung — geometry handoff', () => {
  it.each([
    ['a plain rung', { logic: contact('A'), outputs: [coil('Run')] }],
    ['a series', { logic: { series: [contact('A'), contact('B')] } as RungLogic, outputs: [coil('Run')] }],
    ['a parallel', { logic: { parallel: [contact('A'), contact('B')] } as RungLogic, outputs: [coil('Run')] }],
  ])('asks the store to lay out %s', (_label, input) => {
    const rung = buildLadderRung({ rungId: 'r1', ...input })

    expect(needsPositionRecovery(rung)).toBe(true)
  })

  it('puts every non-rail element at the origin, never leaves position absent', () => {
    const rung = buildLadderRung({
      rungId: 'r1',
      logic: { parallel: [contact('A'), contact('B')] },
      outputs: [coil('Run')],
    })

    for (const node of rung.nodes as Node[]) {
      expect(node.position).toBeDefined()
      if (node.type === 'powerRail') continue
      expect(node.position).toEqual({ x: 0, y: 0 })
    }
  })

  it('gives every edge both handles, which the flow schema requires', () => {
    // `buildEdge` writes `undefined` when a handle is omitted, and that
    // stringifies into the edge id as the literal "undefined".
    const rung = buildLadderRung({
      rungId: 'r1',
      logic: { parallel: [contact('A'), contact('B')] },
      outputs: [coil('Run')],
    })

    for (const edge of rung.edges) {
      expect(typeof edge.sourceHandle).toBe('string')
      expect(typeof edge.targetHandle).toBe('string')
      expect(edge.id).not.toContain('undefined')
    }
  })
})

describe('buildLadderRung — every edge resolves to a real handle', () => {
  // React Flow drops an edge whose handle id is not declared on the node it
  // names, and drops it silently apart from a console warning. The rung still
  // transpiles — the LD walker reads node/edge topology, not handles — so
  // nothing but this catches a wrong id.
  const handlesOf = (node: Node) => (node.data as { handles: { id: string; type: string }[] }).handles

  const ton = {
    name: 'TON',
    type: 'function-block',
    variables: [
      { name: 'IN', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
      { name: 'PT', class: 'input', type: { definition: 'base-type', value: 'TIME' } },
      { name: 'Q', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
      { name: 'ET', class: 'output', type: { definition: 'base-type', value: 'TIME' } },
    ],
  }

  it.each([
    ['a plain rung', { logic: contact('A'), outputs: [coil('Run')] }],
    ['a series', { logic: { series: [contact('A'), contact('B')] } as RungLogic, outputs: [coil('Run')] }],
    ['a parallel', { logic: { parallel: [contact('A'), contact('B')] } as RungLogic, outputs: [coil('Run')] }],
    [
      'a nested parallel',
      {
        logic: { parallel: [contact('A'), { parallel: [contact('B'), contact('C')] }] } as RungLogic,
        outputs: [coil('Run')],
      },
    ],
    ['no logic at all', { outputs: [coil('Run')] }],
    ['two outputs', { logic: contact('A'), outputs: [coil('Run'), coil('Alarm')] }],
    ['a block sink', { logic: contact('A'), outputs: [{ block: { variant: ton, instance: 'delay' } }] }],
  ])('resolves both ends of every edge in %s', (_label, input) => {
    const rung = buildLadderRung({ rungId: 'r1', ...input })
    const byId = new Map((rung.nodes as Node[]).map((node) => [node.id, node]))

    for (const edge of rung.edges) {
      const source = byId.get(edge.source)
      const target = byId.get(edge.target)
      expect(source).toBeDefined()
      expect(target).toBeDefined()

      expect(handlesOf(source as Node).map((handle) => handle.id)).toContain(edge.sourceHandle)
      expect(handlesOf(target as Node).map((handle) => handle.id)).toContain(edge.targetHandle)

      const out = handlesOf(source as Node).find((handle) => handle.id === edge.sourceHandle)
      const into = handlesOf(target as Node).find((handle) => handle.id === edge.targetHandle)
      expect(out?.type).toBe('source')
      expect(into?.type).toBe('target')
    }
  })

  it('wires the rails by the handle they actually carry, not by their name', () => {
    // A rail's handle id is the opposite of its `connector`: the left rail
    // carries `left-rail`, built with `connector: 'right'`.
    const rung = buildLadderRung({ rungId: 'r1', logic: contact('A'), outputs: [coil('Run')] })
    const nodes = rung.nodes as Node[]
    const left = nodes.find((node) => node.id === 'left-rail-r1') as Node
    const right = nodes.find((node) => node.id === 'right-rail-r1') as Node

    expect(handlesOf(left)[0].id).toBe('left-rail')
    expect(handlesOf(right)[0].id).toBe('right-rail')

    const fromLeft = rung.edges.find((edge) => edge.source === left.id)
    const toRight = rung.edges.find((edge) => edge.target === right.id)
    expect(fromLeft?.sourceHandle).toBe('left-rail')
    expect(toRight?.targetHandle).toBe('right-rail')
  })
})

describe('buildLadderRung — declared variables', () => {
  // The editor stores the whole declared variable on an element and checks the
  // two agree; a block whose instance does not resolve is ringed red in the
  // diagram. A name on its own is not enough.
  const declared = [
    { name: 'Start', class: 'local', type: { definition: 'base-type', value: 'BOOL' } },
    { name: 'Run', class: 'local', type: { definition: 'base-type', value: 'BOOL' } },
    { name: 'holdOff', class: 'local', type: { definition: 'derived', value: 'TON' } },
  ]
  const resolveVariable = (name: string, kind: 'contact' | 'coil' | 'block') =>
    declared.find(
      (variable) =>
        variable.name.toLowerCase() === name.toLowerCase() &&
        (kind === 'block' || variable.type.definition !== 'derived'),
    )

  const variableOf = (nodes: Node[], type: string) =>
    (nodes.find((node) => node.type === type)?.data as { variable: Record<string, unknown> }).variable

  it('carries the declared variable onto a contact and a coil, not just the name', () => {
    const rung = buildLadderRung({
      rungId: 'r1',
      logic: contact('Start'),
      outputs: [coil('Run')],
      resolveVariable,
    })

    expect(variableOf(rung.nodes as Node[], 'contact')).toEqual(declared[0])
    expect(variableOf(rung.nodes as Node[], 'coil')).toEqual(declared[1])
  })

  it('carries the instance variable onto a block', () => {
    const rung = buildLadderRung({
      rungId: 'r1',
      outputs: [{ block: { variant: { name: 'TON', type: 'function-block', variables: [] }, instance: 'holdOff' } }],
      resolveVariable,
    })

    expect(variableOf(rung.nodes as Node[], 'block')).toEqual(declared[2])
  })

  it('leaves a name that resolves to nothing as a bare name', () => {
    const rung = buildLadderRung({ rungId: 'r1', logic: contact('Nope'), outputs: [coil('Run')], resolveVariable })

    expect(variableOf(rung.nodes as Node[], 'contact')).toEqual({ name: 'Nope' })
  })

  it('refuses a derived type on a contact, as the editor does', () => {
    const rung = buildLadderRung({ rungId: 'r1', logic: contact('holdOff'), outputs: [coil('Run')], resolveVariable })

    expect(variableOf(rung.nodes as Node[], 'contact')).toEqual({ name: 'holdOff' })
  })
})

describe('buildLadderRung — where rung power enters a block', () => {
  // A block wired EN/ENO is only gated by the rung: its own inputs stay open,
  // so a timer never times. Power has to go through the block's first boolean
  // input and out its first boolean output, which is how the editor draws one.
  const ton = {
    name: 'TON',
    type: 'function-block',
    variables: [
      { name: 'IN', class: 'input', type: { definition: 'base-type', value: 'BOOL' } },
      { name: 'PT', class: 'input', type: { definition: 'base-type', value: 'TIME' } },
      { name: 'Q', class: 'output', type: { definition: 'base-type', value: 'BOOL' } },
      { name: 'ET', class: 'output', type: { definition: 'base-type', value: 'TIME' } },
    ],
  }
  // ADD's first input is not BOOL, so the editor forces EN/ENO on regardless.
  const add = {
    name: 'ADD',
    type: 'function',
    variables: [
      { name: 'IN1', class: 'input', type: { definition: 'base-type', value: 'INT' } },
      { name: 'IN2', class: 'input', type: { definition: 'base-type', value: 'INT' } },
      { name: 'OUT', class: 'output', type: { definition: 'base-type', value: 'INT' } },
    ],
  }

  const blockEdges = (rung: ReturnType<typeof buildLadderRung>) => {
    const block = (rung.nodes as Node[]).find((node) => node.type === 'block') as Node
    return {
      into: rung.edges.find((edge) => edge.target === block.id)?.targetHandle,
      outOf: rung.edges.find((edge) => edge.source === block.id)?.sourceHandle,
      handles: (block.data as { handles: { id: string }[] }).handles.map((handle) => handle.id),
    }
  }

  it('drives the first boolean input and leaves on the first boolean output', () => {
    const rung = buildLadderRung({
      rungId: 'r1',
      logic: contact('Run'),
      outputs: [{ block: { variant: ton, instance: 'holdOff' } }, coil('Settled')],
    })

    const { into, outOf, handles } = blockEdges(rung)
    expect(into).toBe('IN')
    expect(outOf).toBe('Q')
    expect(handles).not.toContain('EN')
    expect(handles).not.toContain('ENO')
  })

  it('uses EN/ENO when the caller asks for execution control', () => {
    const rung = buildLadderRung({
      rungId: 'r1',
      logic: contact('Run'),
      outputs: [{ block: { variant: ton, instance: 'holdOff', executionControl: true } }],
    })

    const { into, outOf } = blockEdges(rung)
    expect(into).toBe('EN')
    expect(outOf).toBe('ENO')
  })

  it('still gets EN/ENO when the block cannot carry power itself', () => {
    const rung = buildLadderRung({ rungId: 'r1', logic: contact('Permit'), outputs: [{ block: { variant: add } }] })

    const { into, outOf, handles } = blockEdges(rung)
    expect(handles).toContain('EN')
    expect(into).toBe('EN')
    expect(outOf).toBe('ENO')
  })
})

describe('buildLadderRung — a parallel nested in a parallel', () => {
  // A pair carries a SECOND set of connectors, `input-top` and `output-top`,
  // that exist only for nesting: they sit a connector's height above the
  // ordinary ones, which is what makes concentric brackets draw as brackets.
  // `startParallelConnection` overrides the handles for exactly this case;
  // wiring the inner pair by its plain `input`/`output-right` instead drew the
  // branch verticals in a staircase.
  const nested = buildLadderRung({
    rungId: 'r1',
    logic: { parallel: [contact('A'), contact('B'), contact('C')] },
    outputs: [coil('Run')],
  })

  /**
   * Resolved by the pair's own cross-references, not by position: nodes are
   * pushed `[open, …straight, …down, close]`, so the INNER close precedes the
   * outer one and an index would name the wrong node.
   */
  const pairs = (rung: typeof nested) => {
    const nodes = rung.nodes as Node[]
    const opens = nodes.filter((node) => node.type === 'parallel' && (node.data as { type: string }).type === 'open')
    const closeOf = (open: Node) =>
      nodes.find((node) => node.id === (open.data as { parallelCloseReference?: string }).parallelCloseReference)
    const innerOpen = opens.find((open) =>
      rung.edges.some((edge) => edge.target === open.id && edge.sourceHandle === 'output-down'),
    )
    const outerOpen = opens.find((open) => open.id !== innerOpen?.id)
    return {
      outerOpen,
      innerOpen,
      outerClose: outerOpen && closeOf(outerOpen),
      innerClose: innerOpen && closeOf(innerOpen),
    }
  }

  it('enters the inner pair by its top connector', () => {
    const { outerOpen, innerOpen } = pairs(nested)
    const down = nested.edges.find((edge) => edge.source === outerOpen?.id && edge.sourceHandle === 'output-down')

    expect(down?.target).toBe(innerOpen?.id)
    expect(down?.targetHandle).toBe('input-top')
  })

  it('leaves the inner pair by its top connector', () => {
    const { outerClose, innerClose } = pairs(nested)
    const up = nested.edges.find((edge) => edge.target === outerClose?.id && edge.targetHandle === 'input-down')

    expect(up?.source).toBe(innerClose?.id)
    expect(up?.sourceHandle).toBe('output-top')
  })

  it('still wires a plain two-branch pair by its ordinary connectors', () => {
    // The override is for nesting only — a contact on the down path is entered
    // at its own input, as before.
    const flat = buildLadderRung({
      rungId: 'r1',
      logic: { parallel: [contact('A'), contact('B')] },
      outputs: [coil('Run')],
    })
    const open = (flat.nodes as Node[]).find(
      (node) => node.type === 'parallel' && (node.data as { type: string }).type === 'open',
    )
    const down = flat.edges.find((edge) => edge.source === open?.id && edge.sourceHandle === 'output-down')

    expect(down?.targetHandle).toBe('input')
  })
})
