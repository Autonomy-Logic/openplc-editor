import { layoutFbdGraph } from '../layout'

// FBD has no recovery pass — whatever this produces is where the diagram sits
// when someone opens it. The rule is signal flow: a node stands to the right of
// everything that feeds it.

const nodes = (...ids: string[]) => ids.map((id) => ({ id }))
const x = (result: ReturnType<typeof layoutFbdGraph>, id: string) => result.positions.get(id)?.x
const y = (result: ReturnType<typeof layoutFbdGraph>, id: string) => result.positions.get(id)?.y

describe('layoutFbdGraph', () => {
  it('puts an unconnected graph in one column', () => {
    const result = layoutFbdGraph(nodes('a', 'b', 'c'), [])

    expect([x(result, 'a'), x(result, 'b'), x(result, 'c')]).toEqual([0, 0, 0])
    expect(y(result, 'a')).toBeLessThan(y(result, 'b')!)
  })

  it('moves each node right of what feeds it', () => {
    const result = layoutFbdGraph(nodes('in', 'blk', 'out'), [
      { from: 'in', to: 'blk' },
      { from: 'blk', to: 'out' },
    ])

    expect(x(result, 'in')).toBeLessThan(x(result, 'blk')!)
    expect(x(result, 'blk')).toBeLessThan(x(result, 'out')!)
  })

  it('waits for the deepest input, not the first', () => {
    // `deep` arrives two hops later than `shallow`; `sink` must clear both.
    const result = layoutFbdGraph(nodes('shallow', 'a', 'deep', 'sink'), [
      { from: 'a', to: 'deep' },
      { from: 'shallow', to: 'sink' },
      { from: 'deep', to: 'sink' },
    ])

    expect(x(result, 'sink')).toBeGreaterThan(x(result, 'deep')!)
    expect(x(result, 'sink')).toBeGreaterThan(x(result, 'shallow')!)
  })

  it('stacks a fan-in into separate rows of the same column', () => {
    const result = layoutFbdGraph(nodes('a', 'b', 'sink'), [
      { from: 'a', to: 'sink' },
      { from: 'b', to: 'sink' },
    ])

    expect(x(result, 'a')).toBe(x(result, 'b'))
    expect(y(result, 'a')).not.toBe(y(result, 'b'))
  })

  it('spreads a fan-out across rows', () => {
    const result = layoutFbdGraph(nodes('src', 'one', 'two'), [
      { from: 'src', to: 'one' },
      { from: 'src', to: 'two' },
    ])

    expect(x(result, 'one')).toBe(x(result, 'two'))
    expect(y(result, 'one')).not.toBe(y(result, 'two'))
  })

  it('breaks a feedback loop and reports it, rather than throwing', () => {
    // A latch feeding its own reset is an ordinary FBD diagram.
    const result = layoutFbdGraph(nodes('a', 'b'), [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'a' },
    ])

    expect(result.positions.size).toBe(2)
    expect(result.brokenCycles.length).toBeGreaterThan(0)
  })

  it('survives a self-loop', () => {
    const result = layoutFbdGraph(nodes('a'), [{ from: 'a', to: 'a' }])

    expect(result.positions.get('a')).toEqual({ x: 0, y: 0 })
  })

  it('is deterministic — the same graph lays out the same way twice', () => {
    const graph = nodes('a', 'b', 'c')
    const edges = [
      { from: 'a', to: 'c' },
      { from: 'b', to: 'c' },
    ]

    expect([...layoutFbdGraph(graph, edges).positions]).toEqual([...layoutFbdGraph(graph, edges).positions])
  })

  it('ignores a connection naming a node that is not in the graph', () => {
    const result = layoutFbdGraph(nodes('a'), [{ from: 'ghost', to: 'a' }])

    expect(result.positions.get('a')).toEqual({ x: 0, y: 0 })
  })

  it('honours the pitch and origin it is given', () => {
    const result = layoutFbdGraph(nodes('a', 'b'), [{ from: 'a', to: 'b' }], {
      columnPitch: 10,
      rowPitch: 5,
      originX: 100,
      originY: 50,
    })

    expect(result.positions.get('a')).toEqual({ x: 100, y: 50 })
    expect(result.positions.get('b')).toEqual({ x: 110, y: 50 })
  })
})
