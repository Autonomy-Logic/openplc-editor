import { computeGraphicalDiff } from '@root/backend/shared/utils/graphical-diff'
import type { Edge, Node } from '@xyflow/react'

type Rung = { id?: string; nodes: Node[]; edges?: Edge[] }

const rail = (id: string): Node => ({ id, type: 'powerRail', position: { x: 0, y: 50 }, data: {} })

const contact = (id: string, name: string, x: number): Node => ({
  id,
  type: 'contact',
  position: { x, y: 50 },
  data: { variable: { name } },
})

const coil = (id: string, name: string, x: number): Node => ({
  id,
  type: 'coil',
  position: { x, y: 50 },
  data: { variable: { name } },
})

const edge = (source: string, target: string): Edge => ({ id: `e_${source}_${target}`, source, target })

const withBody = (body: unknown) => `PROGRAM main\nVAR\n  A : BOOL;\nEND_VAR\n${JSON.stringify(body)}\nEND_PROGRAM`

const ld = (rungs: Rung[]) => withBody({ rungs: rungs.map((r) => ({ edges: [], ...r })) })
const fbd = (rung: Rung) => withBody({ rung: { edges: [], ...rung } })

const diffLd = (original: Rung[], current: Rung[]) =>
  computeGraphicalDiff(ld(original), ld(current), 'pous/programs/main.ld')

describe('computeGraphicalDiff — node matching', () => {
  it('leaves an untouched rung alone when another rung rebinds a same-key element (DOPE-496)', () => {
    const head: Rung[] = [
      { id: 'r1', nodes: [rail('RAIL_1'), contact('NODE_c1', '', 100), coil('NODE_coil1', 'A', 300)] },
      {
        id: 'r2',
        nodes: [
          rail('RAIL_2'),
          contact('NODE_c2L', '', 100),
          contact('NODE_c2R', '', 200),
          coil('NODE_coil2', 'B', 300),
        ],
      },
    ]
    const work: Rung[] = [
      { id: 'r1', nodes: [rail('RAIL_1'), contact('NODE_c1', 'new', 100), coil('NODE_coil1', 'A', 300)] },
      head[1],
      { id: 'r3', nodes: [rail('RAIL_3'), contact('NODE_c3', '', 100), coil('NODE_coil3', 'C', 300)] },
    ]

    const { nodeDiffMaps, changedIndexes } = diffLd(head, work)

    expect(nodeDiffMaps.current.get('NODE_c1')).toBe('modified')
    expect(nodeDiffMaps.original.get('NODE_c1')).toBe('modified')

    for (const id of ['NODE_c2L', 'NODE_c2R', 'NODE_coil2']) {
      expect(nodeDiffMaps.original.get(id)).toBe('unchanged')
      expect(nodeDiffMaps.current.get(id)).toBe('unchanged')
    }

    expect(nodeDiffMaps.current.get('NODE_c3')).toBe('added')
    expect(nodeDiffMaps.current.get('NODE_coil3')).toBe('added')
    expect(changedIndexes).toEqual([0, 2])
  })

  it('keeps matches rung-local when an XML round trip regenerated the node ids', () => {
    const head: Rung[] = [
      { id: 'r1', nodes: [contact('CONTACT-1', '', 100), coil('COIL-1', 'A', 300)] },
      { id: 'r2', nodes: [contact('CONTACT-2', '', 100), coil('COIL-2', 'B', 300)] },
    ]
    const work: Rung[] = [
      {
        id: 'r1',
        nodes: [contact('CONTACT-1', 'new', 100), contact('CONTACT-2', '', 200), coil('COIL-1', 'A', 400)],
      },
      { id: 'r2', nodes: [contact('CONTACT-3', '', 100), coil('COIL-2', 'B', 300)] },
    ]

    const { nodeDiffMaps, changedIndexes } = diffLd(head, work)

    expect(nodeDiffMaps.current.get('CONTACT-1')).toBe('modified')
    expect(nodeDiffMaps.current.get('CONTACT-2')).toBe('added')
    // rung 2's renumbered contact matches its own rung's contact, not rung 1's
    expect(nodeDiffMaps.current.get('CONTACT-3')).toBe('unchanged')
    expect(nodeDiffMaps.original.get('CONTACT-2')).toBe('unchanged')
    expect(nodeDiffMaps.current.get('COIL-2')).toBe('unchanged')
    expect(changedIndexes).toEqual([0])
  })

  it('reports a deleted element as removed without stealing another rung nodes', () => {
    const head: Rung[] = [
      { id: 'r1', nodes: [contact('NODE_c1', '', 100), coil('NODE_coil1', 'A', 300)] },
      { id: 'r2', nodes: [contact('NODE_c2L', '', 100), contact('NODE_c2R', '', 200), coil('NODE_coil2', 'B', 300)] },
    ]
    const work: Rung[] = [head[0], { id: 'r2', nodes: [contact('NODE_c2L', '', 100), coil('NODE_coil2', 'B', 300)] }]

    const { nodeDiffMaps, changedIndexes } = diffLd(head, work)

    expect(nodeDiffMaps.original.get('NODE_c2R')).toBe('removed')
    expect(nodeDiffMaps.original.get('NODE_c1')).toBe('unchanged')
    expect(nodeDiffMaps.current.get('NODE_c1')).toBe('unchanged')
    expect(changedIndexes).toEqual([1])
  })

  it('recovers a node stranded in the wrong rung pair by id instead of add + remove', () => {
    const head: Rung[] = [
      {
        id: 'r1',
        nodes: [contact('NODE_x', 'X', 100), coil('NODE_coil1', 'A', 300)],
        edges: [edge('NODE_x', 'NODE_coil1')],
      },
      { id: 'r2', nodes: [coil('NODE_coil2', 'B', 300)] },
    ]
    const work: Rung[] = [
      { id: 'r1', nodes: [coil('NODE_coil1', 'A', 300)] },
      {
        // x differs from r1's, so this fails if the cross-rung pass compares position.
        id: 'r2',
        nodes: [contact('NODE_x', 'X', 250), coil('NODE_coil2', 'B', 300)],
        edges: [edge('NODE_x', 'NODE_coil2')],
      },
    ]

    const { nodeDiffMaps, changedIndexes } = diffLd(head, work)

    expect(nodeDiffMaps.original.get('NODE_x')).toBe('unchanged')
    expect(nodeDiffMaps.current.get('NODE_x')).toBe('unchanged')
    // both rungs still read as changed, through their edges
    expect(changedIndexes).toEqual([0, 1])
  })

  it('marks structural nodes unchanged on both sides', () => {
    const head: Rung[] = [{ id: 'r1', nodes: [rail('RAIL_1'), contact('NODE_c1', 'X', 100)] }]
    const work: Rung[] = [{ id: 'r1', nodes: [rail('RAIL_1'), contact('NODE_c1', 'Y', 100)] }]

    const { nodeDiffMaps } = diffLd(head, work)

    expect(nodeDiffMaps.original.get('RAIL_1')).toBe('unchanged')
    expect(nodeDiffMaps.current.get('RAIL_1')).toBe('unchanged')
  })
})

describe('computeGraphicalDiff — rung alignment', () => {
  it('aligns rungs by id so an inserted rung does not shift the pairing', () => {
    const head: Rung[] = [
      { id: 'r1', nodes: [contact('NODE_c1', '', 100), coil('NODE_coil1', 'A', 300)] },
      { id: 'r2', nodes: [contact('NODE_c2', '', 100), coil('NODE_coil2', 'B', 300)] },
    ]
    const work: Rung[] = [{ id: 'rNEW', nodes: [contact('NODE_cN', '', 100), coil('NODE_coilN', 'Z', 300)] }, ...head]

    const { flows, changedIndexes, nodeDiffMaps } = diffLd(head, work)

    expect(flows).toHaveLength(3)
    expect(flows[0].original).toBeNull()
    expect(flows[0].current?.id).toBe('rNEW')
    expect(flows[1].original?.id).toBe('r1')
    expect(flows[1].current?.id).toBe('r1')
    expect(flows[2].original?.id).toBe('r2')
    expect(flows[2].current?.id).toBe('r2')
    expect(changedIndexes).toEqual([0])
    expect(nodeDiffMaps.current.get('NODE_c2')).toBe('unchanged')
    expect(nodeDiffMaps.current.get('NODE_cN')).toBe('added')
  })

  it('reports a rung deleted from the middle as a removed rung', () => {
    const head: Rung[] = [
      { id: 'r1', nodes: [coil('NODE_coil1', 'A', 300)] },
      { id: 'r2', nodes: [coil('NODE_coil2', 'B', 300)] },
      { id: 'r3', nodes: [coil('NODE_coil3', 'C', 300)] },
    ]
    const work: Rung[] = [head[0], head[2]]

    const { flows, changedIndexes, nodeDiffMaps } = diffLd(head, work)

    expect(flows).toHaveLength(3)
    expect(flows[1].original?.id).toBe('r2')
    expect(flows[1].current).toBeNull()
    expect(changedIndexes).toEqual([1])
    expect(nodeDiffMaps.original.get('NODE_coil2')).toBe('removed')
    expect(nodeDiffMaps.current.get('NODE_coil3')).toBe('unchanged')
  })

  it('falls back to positional pairing when rung ids are missing', () => {
    const head: Rung[] = [{ nodes: [contact('NODE_c1', 'X', 100)] }, { nodes: [coil('NODE_coil2', 'B', 300)] }]
    const work: Rung[] = [{ nodes: [contact('NODE_c1', 'Y', 100)] }, head[1]]

    const { flows, changedIndexes, nodeDiffMaps } = diffLd(head, work)

    expect(flows).toHaveLength(2)
    expect(nodeDiffMaps.current.get('NODE_c1')).toBe('modified')
    expect(changedIndexes).toEqual([0])
  })

  it('falls back to positional pairing when the two sides share no rung id', () => {
    const nodesA = [contact('NODE_c1', 'X', 100), coil('NODE_coil1', 'A', 300)]
    const nodesB = [contact('NODE_c2', 'Y', 100), coil('NODE_coil2', 'B', 300)]
    const head: Rung[] = [
      { id: 'uuid-aaa', nodes: nodesA },
      { id: 'uuid-bbb', nodes: nodesB },
    ]
    const work: Rung[] = [
      { id: 'rung-0', nodes: nodesA },
      { id: 'rung-1', nodes: nodesB },
    ]

    const { flows, changedIndexes } = diffLd(head, work)

    expect(flows).toHaveLength(2)
    expect(flows[0].original?.id).toBe('uuid-aaa')
    expect(flows[0].current?.id).toBe('rung-0')
    expect(changedIndexes).toEqual([])
  })

  it('falls back to positional pairing above the alignable rung count', () => {
    const mk = (count: number, prefix: string): Rung[] =>
      Array.from({ length: count }, (_, i) => ({ id: `${prefix}${i}`, nodes: [coil(`${prefix}coil${i}`, 'A', 300)] }))
    const head = mk(1000, 'r')
    const work = [{ id: 'rNEW', nodes: [coil('NODE_coilN', 'Z', 300)] }, ...head]

    const { flows } = diffLd(head, work)

    expect(flows).toHaveLength(1001)
    expect(flows[0].original?.id).toBe('r0')
    expect(flows[0].current?.id).toBe('rNEW')
  })

  it('falls back to positional pairing when rung ids are duplicated', () => {
    const head: Rung[] = [
      { id: 'dup', nodes: [contact('NODE_c1', 'X', 100)] },
      { id: 'dup', nodes: [coil('NODE_coil2', 'B', 300)] },
    ]
    const work: Rung[] = [{ id: 'dup', nodes: [contact('NODE_c1', 'Y', 100)] }, head[1]]

    const { flows, nodeDiffMaps } = diffLd(head, work)

    expect(flows).toHaveLength(2)
    expect(nodeDiffMaps.current.get('NODE_c1')).toBe('modified')
    expect(nodeDiffMaps.current.get('NODE_coil2')).toBe('unchanged')
  })
})

describe('computeGraphicalDiff — FBD', () => {
  it('reports a rebound variable as modified rather than add + remove', () => {
    const original = fbd({ nodes: [contact('NODE_a', 'IN1', 100), coil('NODE_b', 'OUT', 300)] })
    const current = fbd({ nodes: [contact('NODE_a', 'IN2', 100), coil('NODE_b', 'OUT', 300)] })

    const { nodeDiffMaps, isLadder } = computeGraphicalDiff(original, current, 'pous/programs/main.fbd')

    expect(isLadder).toBe(false)
    expect(nodeDiffMaps.original.get('NODE_a')).toBe('modified')
    expect(nodeDiffMaps.current.get('NODE_a')).toBe('modified')
    expect(nodeDiffMaps.current.get('NODE_b')).toBe('unchanged')
  })
})
