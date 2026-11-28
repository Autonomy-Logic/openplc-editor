import { fbdNodesInView, type FbdNodeGeometry, flowViewRect, idsInVerticalView } from '../debug-diagram-viewport'

const node = (id: string, x: number, y: number, type = 'input-variable'): FbdNodeGeometry => ({
  id,
  type,
  position: { x, y },
  measured: { width: 100, height: 40 },
})

describe('flowViewRect', () => {
  it('maps the pane through the pan and zoom of the flow', () => {
    expect(flowViewRect({ x: -200, y: 100, zoom: 2 }, 800, 400)).toEqual({ x: 100, y: -50, width: 400, height: 200 })
  })
})

describe('fbdNodesInView', () => {
  const view = { x: 0, y: 0, width: 500, height: 300 }

  it('keeps the nodes the view overlaps, in node order', () => {
    const nodes = [node('far', 2000, 2000), node('a', 450, 280), node('b', 10, 10), node('left', -150, 0)]
    expect(fbdNodesInView(nodes, [], view)).toEqual(['a', 'b'])
  })

  it('adds the source of a wire on screen whose source node is off screen', () => {
    const nodes = [node('src', -900, 100), node('dst', 100, 100), node('other', -900, 900)]
    expect(fbdNodesInView(nodes, [{ source: 'src', target: 'dst' }], view)).toEqual(['src', 'dst'])
  })

  it('adds the source of a wire crossing the view with both nodes off screen', () => {
    const nodes = [node('src', -900, 100), node('dst', 1500, 100)]
    expect(fbdNodesInView(nodes, [{ source: 'src', target: 'dst' }], view)).toEqual(['src'])
  })

  it('traces a wire back through connectors and continuations to the node that drives it', () => {
    const nodes = [
      node('driver', -2000, 0, 'block'),
      node('connector', -1500, 0, 'connector'),
      node('continuation', -900, 0, 'continuation'),
      node('dst', 100, 0, 'output-variable'),
      node('unrelated', -3000, 0, 'block'),
    ]
    const edges = [
      { source: 'driver', target: 'connector' },
      { source: 'connector', target: 'continuation' },
      { source: 'continuation', target: 'dst' },
      { source: 'unrelated', target: 'driver' },
    ]
    expect(fbdNodesInView(nodes, edges, view)).toEqual(['driver', 'connector', 'continuation', 'dst'])
  })

  it('handles 20000 nodes and wires in well under a frame budget per call', () => {
    const nodes = Array.from({ length: 20000 }, (_, i) => node(`n${i}`, (i % 200) * 150, Math.floor(i / 200) * 80))
    const edges = nodes.slice(1).map((target, i) => ({ source: nodes[i].id, target: target.id }))
    const started = performance.now()
    const ids = fbdNodesInView(nodes, edges, view)
    expect(performance.now() - started).toBeLessThan(200)
    expect(ids.length).toBeLessThan(60)
  })
})

describe('idsInVerticalView', () => {
  const items = [
    { id: 'r1', top: 0, bottom: 100 },
    { id: 'r2', top: 100, bottom: 400 },
    { id: 'r3', top: 400, bottom: 500 },
  ]

  it('keeps the items partly or fully between top and bottom', () => {
    expect(idsInVerticalView(items, 150, 420)).toEqual(['r2', 'r3'])
    expect(idsInVerticalView(items, 50, 60)).toEqual(['r1'])
  })

  it('keeps nothing when the view has no height', () => {
    expect(idsInVerticalView(items, 150, 150)).toEqual([])
  })
})
