import { applyFbdEdgeTheme, getFbdEdgeType } from './edges'

describe('getFbdEdgeType', () => {
  it('uses step edges for SquareTeal', () => {
    expect(getFbdEdgeType('squareteal')).toBe('step')
  })

  it.each(['light', 'dark', 'nineties'] as const)('keeps smoothstep edges for %s', (theme) => {
    expect(getFbdEdgeType(theme)).toBe('smoothstep')
  })
})

describe('applyFbdEdgeTheme', () => {
  const smoothEdge = { id: 'smooth', type: 'smoothstep', source: 'a' }
  const stepEdge = { id: 'step', type: 'step', source: 'b' }

  it('returns existing edges unchanged for non-square themes', () => {
    const edges = [smoothEdge, stepEdge]

    expect(applyFbdEdgeTheme(edges, 'light')).toBe(edges)
  })

  it('renders SquareTeal edges as steps without mutating stored edges', () => {
    const edges = [smoothEdge, stepEdge]

    const themedEdges = applyFbdEdgeTheme(edges, 'squareteal')

    expect(themedEdges).toEqual([
      { id: 'smooth', type: 'step', source: 'a' },
      { id: 'step', type: 'step', source: 'b' },
    ])
    expect(themedEdges).not.toBe(edges)
    expect(themedEdges[0]).not.toBe(smoothEdge)
    expect(themedEdges[1]).toBe(stepEdge)
    expect(smoothEdge.type).toBe('smoothstep')
  })
})
