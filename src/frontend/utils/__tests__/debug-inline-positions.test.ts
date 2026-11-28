import { type DebugInlinePosition, findDebugInlinePositions } from '../debug-inline-positions'

const inOrder = (positions: DebugInlinePosition[]) =>
  [...positions].sort((a, b) => a.line - b.line || a.startCol - b.startCol)

const body = (lines: string[]) => ({ getLine: (n: number) => lines[n - 1], lineCount: lines.length })

describe('findDebugInlinePositions', () => {
  it('places values only on the visible lines', () => {
    const { getLine, lineCount } = body(['a := 1;', 'b := a;', 'c := b;'])
    const positions = inOrder(findDebugInlinePositions(getLine, lineCount, [[2, 2]], ['a', 'b', 'c']))
    expect(positions).toEqual([
      { expr: 'b', line: 2, startCol: 1, endCol: 2 },
      { expr: 'a', line: 2, startCol: 6, endCol: 7 },
    ])
  })

  it('honours a block comment opened above the visible lines', () => {
    const { getLine, lineCount } = body(['(* start', 'a := 1;', '*) b := a;'])
    const positions = inOrder(findDebugInlinePositions(getLine, lineCount, [[2, 3]], ['a', 'b']))
    expect(positions).toEqual([
      { expr: 'b', line: 3, startCol: 4, endCol: 5 },
      { expr: 'a', line: 3, startCol: 9, endCol: 10 },
    ])
  })

  it('prefers the longest expression and matches case-insensitively', () => {
    const { getLine, lineCount } = body(['out := TMR.q AND tmr;'])
    const positions = inOrder(findDebugInlinePositions(getLine, lineCount, [[1, 1]], ['tmr', 'TMR.Q', 'OUT']))
    expect(positions.map(({ expr, startCol }) => [expr, startCol])).toEqual([
      ['OUT', 1],
      ['TMR.Q', 8],
      ['tmr', 18],
    ])
  })

  it('skips expressions that are not on screen among many candidates', () => {
    const { getLine, lineCount } = body(['seq[3] := 1;', 'x := 2;'])
    const exprs = Array.from({ length: 100000 }, (_, i) => `seq[${i}]`).concat('x')
    const started = Date.now()
    const positions = findDebugInlinePositions(getLine, lineCount, [[2, 2]], exprs)
    expect(positions).toEqual([{ expr: 'x', line: 2, startCol: 1, endCol: 2 }])
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('returns nothing when no line is visible', () => {
    const { getLine, lineCount } = body(['a := 1;'])
    expect(findDebugInlinePositions(getLine, lineCount, [], ['a'])).toEqual([])
  })
})
