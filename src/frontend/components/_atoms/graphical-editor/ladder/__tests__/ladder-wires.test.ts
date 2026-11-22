import { presentPou, rungPresentation, type RungLayout } from '@root/middleware/shared/utils/ladder-layout'
import { Position } from '@xyflow/react'

import { ladderWirePath } from '../route-edge'

describe('LD wires', () => {
  it('draws a same-height wire as one straight segment that ends exactly at its target', () => {
    const ends = { sourcePosition: Position.Right, targetPosition: Position.Left }
    expect(ladderWirePath({ ...ends, sourceX: 100, sourceY: 40, targetX: 112, targetY: 40 })).toBe('M100 40 L112 40')
    expect(ladderWirePath({ ...ends, sourceX: 512, sourceY: 40, targetX: 500, targetY: 40.2 })).toBe('M500 40 L500 40')
    expect(ladderWirePath({ ...ends, sourceX: 100, sourceY: 40, targetX: 160, targetY: 80 })).not.toMatch(/^M100 40 L/)
  })

  it('shifts each rung by its own width, even when two rungs reuse the same node ids', () => {
    const rung = (width: number): RungLayout => ({
      rungId: `rung-${width}`,
      nodes: new Map(),
      labels: new Map(),
      size: { width, height: 60 },
      mainWireY: 30,
      rightRailId: 'right-rail',
      trailingOutputIds: ['coil'],
      segments: [],
      parallels: [],
      branchFillers: [],
    })
    const narrow = rung(300)
    const wide = rung(500)
    const pou = presentPou([narrow, wide], 0)
    expect(rungPresentation(pou, narrow).dxByNode.get('coil')).toBe(200)
    expect(rungPresentation(pou, wide).dxByNode.get('right-rail')).toBe(0)
  })
})
