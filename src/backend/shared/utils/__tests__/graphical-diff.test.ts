import { loadCorpusProject } from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/corpus'
import {
  corpusLabelSource,
  loadedRungs,
  relayout,
  savedRungs,
} from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/relayout'
import {
  renamedRung,
  seriesRung,
} from '@root/backend/shared/transpilers/st-transpiler/__tests__/ld-relayout-corpus/rung-builder'
import { computeGraphicalDiff, type DiffStatus } from '@root/backend/shared/utils/graphical-diff'
import type { RungLadderState } from '@root/middleware/shared/ports/types'
import { EMPTY_LABEL_SOURCE } from '@root/middleware/shared/utils/ladder-layout/labels'
import { applyRungLayout, layoutRung } from '@root/middleware/shared/utils/ladder-layout/layout'
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

/** Types the diff never highlights; they stay `unchanged` on both sides. */
const STRUCTURAL = new Set(['powerRail', 'parallel', 'placeholder', 'parallelPlaceholder', 'mockNode', 'variable'])

/** A rung as the editor stores it: laid out by the engine with no located variable. */
const laidOut = (rung: RungLadderState): RungLadderState => applyRungLayout(rung, layoutRung(rung, EMPTY_LABEL_SOURCE))

/** The saved geometry of a node: position and size. */
const geometryOf = (node: Node) => [node.position.x, node.position.y, node.width, node.height]

const statusesOf = (map: Map<string, DiffStatus>, ids: readonly string[]) =>
  Object.fromEntries(ids.map((id) => [id, map.get(id)]))

describe('computeGraphicalDiff — LD marking after a re-layout (BDD-50, AC19)', () => {
  it('a renamed contact is the only modified element, though the engine shifted its neighbours', () => {
    const untouched = laidOut(
      seriesRung('rung_one', [
        { kind: 'contact', id: 'x', name: 'X' },
        { kind: 'coil', id: 'y', name: 'Y' },
      ]),
    )
    const before = seriesRung('rung_two', [
      { kind: 'contact', id: 'start', name: 'Start' },
      { kind: 'contact', id: 'b', name: 'B' },
      { kind: 'coil', id: 'm', name: 'Motor' },
    ])
    const head = laidOut(before)
    const work = laidOut(renamedRung(before, { Start: 'Start_Button_Main_Line' }))
    const moved = (id: string) =>
      geometryOf(head.nodes.find((node) => node.id === id) ?? head.nodes[0]).join() !==
      geometryOf(work.nodes.find((node) => node.id === id) ?? work.nodes[0]).join()
    expect({ b: moved('b'), m: moved('m') }).toEqual({ b: true, m: true })

    const { nodeDiffMaps, changedIndexes } = diffLd([untouched, head], [untouched, work])

    const ids = ['x', 'y', 'start', 'b', 'm']
    const expected = { x: 'unchanged', y: 'unchanged', start: 'modified', b: 'unchanged', m: 'unchanged' }
    expect({
      original: statusesOf(nodeDiffMaps.original, ids),
      current: statusesOf(nodeDiffMaps.current, ids),
      changedIndexes,
    }).toEqual({ original: expected, current: expected, changedIndexes: [1] })
  })

  it('an old-layout commit against the migrated POU marks exactly the elements whose saved geometry changed', () => {
    const basic = loadCorpusProject('ld-corpus-basic')
    const src = corpusLabelSource(basic, 'Main')
    const migrated = relayout(loadedRungs(basic, 'Main'), src)
    const old = savedRungs(basic, 'Main')
    const head = [migrated[0], ...old.slice(1)]

    const { nodeDiffMaps } = diffLd(head, migrated)

    const expected: Record<string, DiffStatus> = {}
    const actual: Record<string, DiffStatus | undefined> = {}
    migrated.forEach((rung, index) => {
      for (const node of rung.nodes) {
        const original = head[index].nodes.find((candidate) => candidate.id === node.id)
        const relaidOut = original !== undefined && geometryOf(original).join() !== geometryOf(node).join()
        expected[node.id] = !STRUCTURAL.has(node.type ?? '') && relaidOut ? 'modified' : 'unchanged'
        actual[node.id] = nodeDiffMaps.current.get(node.id)
      }
    })
    expect(Object.values(expected)).toContain('modified')
    expect(Object.values(expected)).toContain('unchanged')
    expect(actual).toEqual(expected)
  })

  it('a pure re-layout marks an element whose only saved-geometry change is its size', () => {
    const sized = (node: Node, width: number): Node => ({ ...node, width, height: 14 })
    const head: Rung[] = [{ id: 'r1', nodes: [sized(contact('NODE_a', 'A', 100), 22), coil('NODE_q', 'Q', 300)] }]
    const work: Rung[] = [{ id: 'r1', nodes: [sized(contact('NODE_a', 'A', 100), 40), coil('NODE_q', 'Q', 300)] }]

    const { nodeDiffMaps } = diffLd(head, work)

    expect(statusesOf(nodeDiffMaps.current, ['NODE_a', 'NODE_q'])).toEqual({ NODE_a: 'modified', NODE_q: 'unchanged' })
  })

  it('a resized element stays unchanged when another element of its rung changed content', () => {
    const sized = (node: Node, width: number): Node => ({ ...node, width, height: 14 })
    const head: Rung[] = [{ id: 'r1', nodes: [sized(contact('NODE_a', 'A', 100), 22), coil('NODE_q', 'Q', 300)] }]
    const work: Rung[] = [{ id: 'r1', nodes: [sized(contact('NODE_a', 'A', 100), 40), coil('NODE_q', 'Q2', 300)] }]

    const { nodeDiffMaps } = diffLd(head, work)

    expect(statusesOf(nodeDiffMaps.current, ['NODE_a', 'NODE_q'])).toEqual({ NODE_a: 'unchanged', NODE_q: 'modified' })
  })

  it('a moved element stays unchanged when an element was added to its rung', () => {
    const head: Rung[] = [{ id: 'r1', nodes: [contact('NODE_a', 'A', 100), coil('NODE_q', 'Q', 300)] }]
    const work: Rung[] = [
      { id: 'r1', nodes: [contact('NODE_a', 'A', 100), contact('NODE_b', 'B', 200), coil('NODE_q', 'Q', 400)] },
    ]

    const { nodeDiffMaps } = diffLd(head, work)

    expect(statusesOf(nodeDiffMaps.current, ['NODE_a', 'NODE_b', 'NODE_q'])).toEqual({
      NODE_a: 'unchanged',
      NODE_b: 'added',
      NODE_q: 'unchanged',
    })
  })

  it('a moved element stays unchanged when an element was removed from its rung', () => {
    const head: Rung[] = [
      { id: 'r1', nodes: [contact('NODE_a', 'A', 100), contact('NODE_b', 'B', 200), coil('NODE_q', 'Q', 400)] },
    ]
    const work: Rung[] = [{ id: 'r1', nodes: [contact('NODE_a', 'A', 100), coil('NODE_q', 'Q', 300)] }]

    const { nodeDiffMaps } = diffLd(head, work)

    expect({
      removed: nodeDiffMaps.original.get('NODE_b'),
      moved: nodeDiffMaps.current.get('NODE_q'),
    }).toEqual({ removed: 'removed', moved: 'unchanged' })
  })
})

describe('computeGraphicalDiff — FBD', () => {
  it('still marks a moved FBD element modified next to a rebound one', () => {
    const original = fbd({ nodes: [contact('NODE_a', 'IN1', 100), coil('NODE_b', 'OUT', 300)] })
    const current = fbd({ nodes: [contact('NODE_a', 'IN2', 100), coil('NODE_b', 'OUT', 340)] })

    const { nodeDiffMaps } = computeGraphicalDiff(original, current, 'pous/programs/main.fbd')

    expect(statusesOf(nodeDiffMaps.current, ['NODE_a', 'NODE_b'])).toEqual({ NODE_a: 'modified', NODE_b: 'modified' })
  })

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

describe('computeGraphicalDiff — what it is given', () => {
  it('produces an empty diff for a file that is not graphical at all', () => {
    const body = 'PROGRAM main\nVAR\n  A : BOOL;\nEND_VAR\nA := TRUE;\nEND_PROGRAM'

    const result = computeGraphicalDiff(body, body, 'pous/programs/main.st')

    expect(result.isLadder).toBe(false)
    expect(result.flows).toEqual([])
  })

  it('does not let a non-numeric dimension turn the rung height into NaN', () => {
    // A dimension arriving as a string must not concatenate with `y`/`height` instead of adding.
    const poisoned = withBody({
      rungs: [
        {
          id: 'r1',
          edges: [],
          nodes: [{ id: 'N1', type: 'contact', position: { x: 0, y: 0 }, data: {}, width: '120', height: '40' }],
        },
      ],
    })

    const result = computeGraphicalDiff(poisoned, poisoned, 'pous/programs/main.ld')

    expect(Number.isFinite(result.flows[0].originalHeight)).toBe(true)
    expect(Number.isFinite(result.flows[0].originalWidth)).toBe(true)
  })

  it('drops a malformed node instead of losing the rung it sits in', () => {
    const broken = withBody({
      rungs: [{ id: 'r1', edges: [], nodes: [rail('RAIL_1'), { type: 'contact' }, coil('NODE_c', 'A', 300)] }],
    })
    const fixed = ld([{ id: 'r1', nodes: [rail('RAIL_1'), coil('NODE_c', 'A', 300)] }])

    const result = computeGraphicalDiff(broken, fixed, 'pous/programs/main.ld')

    expect(result.flows).toHaveLength(1)
    expect(result.flows[0].original?.nodes.map((n) => n.id)).toEqual(['RAIL_1', 'NODE_c'])
  })
})
