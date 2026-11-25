import type { RungLayout } from '@root/middleware/shared/utils/ladder-layout/types'

import { ldPrintedWidthPx, markerLetter, planLadderPou } from '../ladder-print-plan'

/** A rung layout of `widths.length` segments of the given widths, side by side; the last is its trailing output. */
function rung(id: string, widths: readonly number[]): RungLayout {
  let x = 0
  const segments = widths.map((width, index) => {
    const segment = { nodeIds: [`${id}-${index}`], x, width }
    x += width
    return segment
  })
  return {
    rungId: id,
    nodes: new Map(),
    labels: new Map(),
    size: { width: x, height: 60 },
    mainWireY: 30,
    rightRailId: undefined,
    trailingOutputIds: [`${id}-${widths.length - 1}`],
    segments,
    parallels: [],
    branchFillers: [],
  }
}

const input = (layout: RungLayout) => ({ layout, headerPx: 0 })

describe('planLadderPou', () => {
  it('prints at 100% when it fits, at one shared scale down to 80%, and wraps below that', () => {
    const narrow = rung('a', [100, 100, 100])
    const content = ldPrintedWidthPx(narrow)
    expect(planLadderPou([input(narrow)], content, 10_000, 'normal').pouScale).toBe(1)

    const shared = planLadderPou([input(narrow), input(rung('b', [100, 100, 100]))], content * 0.9, 10_000, 'normal')
    expect(shared.pouScale).toBeCloseTo(0.9, 6)
    expect(shared.rungs.map((plan) => [plan.scale, plan.rows.length])).toEqual([
      [shared.pouScale, 1],
      [shared.pouScale, 1],
    ])

    const wide = planLadderPou([input(rung('c', [200, 200, 200, 200, 200, 100]))], 700, 10_000, 'normal')
    expect(wide.pouScale).toBe(0.8)
    expect(wide.rungs[0].scale).toBe(0.8)
    expect(wide.rungs[0].rows.length).toBeGreaterThan(1)

    const alone = planLadderPou([input(rung('e', [100])), input(rung('f', [2000]))], 700, 10_000, 'normal')
    expect(alone.rungs.map((plan) => plan.rows.length)).toEqual([1, 1])
    expect(alone.rungs[1].scale).toBeLessThan(alone.rungs[0].scale)

    const tall = planLadderPou([input({ ...narrow, size: { width: 300, height: 5000 } })], content, 1000, 'normal')
    expect(tall.rungs[0].heightPx).toBeLessThanOrEqual(1000)

    const fitted = planLadderPou([input(rung('d', [200, 200, 200, 200, 200, 100]))], 700, 10_000, 'scale-to-fit')
    expect(fitted.rungs[0].rows).toHaveLength(1)
    expect(fitted.pouScale).toBeLessThan(0.8)
  })

  it('joins wrapped rows with matching letters, keeps the outputs on the last row and names markers past Z', () => {
    const plan = planLadderPou([input(rung('w', [150, 150, 150, 150, 150, 150, 80]))], 500, 10_000, 'normal')
    const { rows } = plan.rungs[0]
    expect(rows.length).toBeGreaterThan(2)
    rows.slice(1).forEach((row, index) => {
      expect(row.startMarker).toBe(rows[index].endMarker)
      expect(row.startMarker).toBe(markerLetter(index))
    })
    expect(rows[rows.length - 1].endMarker).toBeUndefined()
    expect(rows[rows.length - 1].segmentIndexes).toContain(6)
    expect([markerLetter(0), markerLetter(25), markerLetter(26), markerLetter(27)]).toEqual(['A', 'Z', 'AA', 'AB'])
  })
})
