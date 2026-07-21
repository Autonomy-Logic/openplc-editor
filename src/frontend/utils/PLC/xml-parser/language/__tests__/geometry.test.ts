import { Position } from '@xyflow/react'

import { makeHandle, parsePositionXml, toNumber } from '../geometry'

describe('toNumber', () => {
  it('parses a numeric string', () => {
    expect(toNumber('42')).toBe(42)
  })

  it('falls back to 0 by default for non-numeric input', () => {
    expect(toNumber('not-a-number')).toBe(0)
  })

  it('falls back to a custom fallback value for genuinely non-numeric input', () => {
    // Number('') is 0 (finite), not NaN — the fallback only kicks in for a
    // non-empty, non-numeric string, matching the reference's own behavior.
    expect(toNumber('not-a-number', -1)).toBe(-1)
  })
})

describe('parsePositionXml', () => {
  it('parses @x/@y attributes', () => {
    expect(parsePositionXml({ '@x': '10', '@y': '20' })).toEqual({ x: 10, y: 20 })
  })

  it('defaults to {x:0,y:0} when absent', () => {
    expect(parsePositionXml({})).toEqual({ x: 0, y: 0 })
  })
})

describe('makeHandle', () => {
  it('builds a handle with glbPosition = nodePosition + relPosition', () => {
    const handle = makeHandle('input', 'target', Position.Left, { x: 100, y: 50 }, { '@x': '5', '@y': '10' })
    expect(handle).toEqual({
      id: 'input',
      type: 'target',
      position: Position.Left,
      relPosition: { x: 5, y: 10 },
      glbPosition: { x: 105, y: 60 },
    })
  })
})
