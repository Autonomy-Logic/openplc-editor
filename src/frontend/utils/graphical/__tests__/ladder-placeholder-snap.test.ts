import type { Node } from '@xyflow/react'

import {
  findPlaceholderWithinRadius,
  LADDER_PLACEHOLDER_SNAP_RADIUS,
  selectOnlyPlaceholder,
} from '../ladder-placeholder-snap'

const node = (id: string, type: string, x: number, y: number, extra: Partial<Node> = {}): Node => ({
  id,
  type,
  position: { x, y },
  data: {},
  ...extra,
})

describe('ladder-placeholder-snap', () => {
  const nodes = [
    node('contact', 'contact', 0, 0),
    node('left', 'placeholder', 100, 100),
    node('right', 'placeholder', 160, 100),
    node('below', 'parallelPlaceholder', 100, 160, { measured: { width: 20, height: 20 } }),
  ]

  it('returns the nearest placeholder inside the radius', () => {
    expect(findPlaceholderWithinRadius(nodes, { x: 106, y: 104 })?.id).toBe('left')
    expect(findPlaceholderWithinRadius(nodes, { x: 162, y: 105 })?.id).toBe('right')
    expect(findPlaceholderWithinRadius(nodes, { x: 110, y: 170 })?.id).toBe('below')
  })

  it('returns undefined when no placeholder is close enough', () => {
    expect(findPlaceholderWithinRadius(nodes, { x: 400, y: 400 })).toBeUndefined()
    expect(findPlaceholderWithinRadius(nodes, { x: 105, y: 105 + LADDER_PLACEHOLDER_SNAP_RADIUS + 1 })).toBeUndefined()
  })

  it('never returns a non-placeholder node', () => {
    expect(findPlaceholderWithinRadius([nodes[0]], { x: 0, y: 0 })).toBeUndefined()
  })

  it('uses the explicit node size when present', () => {
    const sized = [node('p', 'placeholder', 0, 0, { width: 40, height: 40 })]
    expect(findPlaceholderWithinRadius(sized, { x: 20, y: 20 }, 1)?.id).toBe('p')
  })

  it('selects only the target placeholder and leaves other nodes alone', () => {
    const withSelection = [{ ...nodes[0], selected: true }, ...nodes.slice(1)]
    const result = selectOnlyPlaceholder(withSelection, 'right')
    expect(result.filter((n) => n.selected).map((n) => n.id)).toEqual(['contact', 'right'])
    expect(result[0]).toBe(withSelection[0])
    expect(selectOnlyPlaceholder(result, 'right')).toBe(result)
    expect(
      selectOnlyPlaceholder(result, undefined)
        .filter((n) => n.selected)
        .map((n) => n.id),
    ).toEqual(['contact'])
  })
})
