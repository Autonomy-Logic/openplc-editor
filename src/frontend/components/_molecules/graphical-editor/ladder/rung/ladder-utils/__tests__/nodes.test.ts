import type { Node } from '@xyflow/react'

import { getRungNodesBounds } from '../nodes'

const node = (overrides: Partial<Node> & Pick<Node, 'position'>): Node => ({
  id: 'n',
  data: {},
  ...overrides,
})

describe('getRungNodesBounds', () => {
  it('falls back to the origin placeholder for an empty rung', () => {
    expect(getRungNodesBounds([])).toEqual({ width: 150, height: 40 })
  })

  it('extends the box to the far edge of each node', () => {
    const bounds = getRungNodesBounds([
      node({ id: 'a', position: { x: 100, y: 40 }, width: 60, height: 30 }),
      node({ id: 'b', position: { x: 400, y: 10 }, width: 80, height: 120 }),
    ])

    expect(bounds).toEqual({ width: 480, height: 130 })
  })

  it('prefers the measured size over the declared one', () => {
    const bounds = getRungNodesBounds([
      node({
        position: { x: 200, y: 0 },
        width: 50,
        height: 20,
        measured: { width: 90, height: 300 },
      }),
    ])

    expect(bounds).toEqual({ width: 290, height: 300 })
  })

  it('treats a node with no dimensions as a point', () => {
    const bounds = getRungNodesBounds([node({ position: { x: 700, y: 500 } })])

    expect(bounds).toEqual({ width: 700, height: 500 })
  })

  it('never shrinks below the origin placeholder', () => {
    const bounds = getRungNodesBounds([node({ position: { x: 5, y: 5 }, width: 10, height: 10 })])

    expect(bounds).toEqual({ width: 150, height: 40 })
  })
})
