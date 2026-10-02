import { reduceSeriesParallel, SeriesParallel, SINK, SOURCE } from '../series-parallel'

const elements = (...ids: string[]) => ids.map((id) => ({ id, value: id }))
const rankByName = (id: string) => id.charCodeAt(0)

function show(expr: SeriesParallel<string>): string {
  switch (expr.kind) {
    case 'wire':
      return '-'
    case 'leaf':
      return expr.value
    case 'series':
      return expr.items.map(show).join(' ')
    case 'parallel':
      return `(${expr.branches.map(show).join(' | ')})`
  }
}

function reduce(ids: string[], wires: Array<[string | typeof SOURCE, string | typeof SINK]>) {
  const result = reduceSeriesParallel(
    elements(...ids),
    wires.map(([from, to]) => ({ from, to })),
    rankByName,
  )
  return result.ok ? show(result.expr) : result.reason
}

describe('reduceSeriesParallel', () => {
  it('reduces an empty rung to a plain wire', () => {
    expect(reduce([], [[SOURCE, SINK]])).toBe('-')
  })

  it('chains elements in series', () => {
    expect(
      reduce(
        ['A', 'B'],
        [
          [SOURCE, 'A'],
          ['A', 'B'],
          ['B', SINK],
        ],
      ),
    ).toBe('A B')
  })

  it('recovers a parallel from a fan-out and a fan-in, ordered by rank', () => {
    expect(
      reduce(
        ['C', 'B', 'A'],
        [
          [SOURCE, 'A'],
          ['A', 'C'],
          ['A', 'B'],
          ['B', SINK],
          ['C', SINK],
        ],
      ),
    ).toBe('A (B | C)')
  })

  it('flattens three branches into one parallel and nests series inside branches', () => {
    expect(
      reduce(
        ['A', 'B', 'C', 'D'],
        [
          [SOURCE, 'A'],
          [SOURCE, 'B'],
          ['B', 'D'],
          [SOURCE, 'C'],
          ['A', SINK],
          ['D', SINK],
          ['C', SINK],
        ],
      ),
    ).toBe('(A | B D | C)')
  })

  it('ignores a wire listed twice', () => {
    expect(
      reduce(
        ['A'],
        [
          [SOURCE, 'A'],
          [SOURCE, 'A'],
          ['A', SINK],
        ],
      ),
    ).toBe('A')
  })

  it('refuses a branch that bypasses its elements', () => {
    expect(
      reduce(
        ['A'],
        [
          [SOURCE, 'A'],
          [SOURCE, SINK],
          ['A', SINK],
        ],
      ),
    ).toBe('a parallel branch has no element on it')
  })

  it('refuses a bypass nested inside a series', () => {
    expect(
      reduce(
        ['A', 'B'],
        [
          [SOURCE, 'A'],
          ['A', 'B'],
          ['A', SINK],
          ['B', SINK],
        ],
      ),
    ).toBe('a parallel branch has no element on it')
  })

  it('refuses an element left hanging off the rung', () => {
    expect(
      reduce(
        ['A', 'B'],
        [
          [SOURCE, 'A'],
          ['A', SINK],
          ['A', 'B'],
        ],
      ),
    ).toBe('the rung is not a series-parallel network from the left rail to the right rail')
  })

  it('refuses an element wired back into itself', () => {
    expect(
      reduce(
        ['A'],
        [
          [SOURCE, SINK],
          ['A', 'A'],
        ],
      ),
    ).toBe('the rung is not a series-parallel network from the left rail to the right rail')
  })

  it('refuses a bridge between two branches', () => {
    expect(
      reduce(
        ['A', 'B', 'C', 'D', 'E'],
        [
          [SOURCE, 'A'],
          [SOURCE, 'B'],
          ['A', 'C'],
          ['B', 'D'],
          ['A', 'E'],
          ['E', 'D'],
          ['C', SINK],
          ['D', SINK],
        ],
      ),
    ).toBe('the rung is not a series-parallel network from the left rail to the right rail')
  })
})
