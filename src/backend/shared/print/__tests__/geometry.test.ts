import type { DrawOp } from '../types'
import {
  composeTransforms,
  dedupeBoundaries,
  gapAlignedCuts,
  lineHeightPt,
  monoCharWidthPt,
  nodeBounds,
  pxToPt,
  resolvePageBox,
  scaleToFitBothAxes,
  scaleToFitWidth,
  textAscentPt,
  textDescentPt,
  transformDrawOp,
  transformDrawOps,
  unionBounds,
} from '../geometry'

describe('unit conversion / font metrics', () => {
  it('pxToPt converts CSS pixels to points', () => {
    expect(pxToPt(96)).toBeCloseTo(72)
  })

  it('textAscentPt / textDescentPt / lineHeightPt scale with size', () => {
    expect(textAscentPt(10)).toBeCloseTo(10.69)
    expect(textDescentPt(10)).toBeCloseTo(2.93)
    expect(lineHeightPt(10)).toBeCloseTo(10.69 + 2.93)
  })

  it('monoCharWidthPt is 0.6em', () => {
    expect(monoCharWidthPt(10)).toBeCloseTo(6)
  })
})

describe('resolvePageBox', () => {
  it('resolves a portrait a4 page and subtracts margins for the content box', () => {
    const box = resolvePageBox({
      size: 'a4',
      orientation: 'portrait',
      marginsPt: { top: 10, right: 20, bottom: 30, left: 40 },
    })
    expect(box.widthPt).toBeCloseTo(595.28)
    expect(box.heightPt).toBeCloseTo(841.89)
    expect(box.contentWidthPt).toBeCloseTo(595.28 - 40 - 20)
    expect(box.contentHeightPt).toBeCloseTo(841.89 - 10 - 30)
  })

  it('swaps width/height for landscape', () => {
    const box = resolvePageBox({
      size: 'letter',
      orientation: 'landscape',
      marginsPt: { top: 0, right: 0, bottom: 0, left: 0 },
    })
    expect(box.widthPt).toBeCloseTo(792)
    expect(box.heightPt).toBeCloseTo(612)
  })
})

describe('nodeBounds', () => {
  it('prefers measured width/height when present', () => {
    const bounds = nodeBounds({ position: { x: 1, y: 2 }, width: 10, height: 10, measured: { width: 50, height: 60 } })
    expect(bounds).toEqual({ x: 1, y: 2, width: 50, height: 60 })
  })

  it('falls back to width/height when measured is absent', () => {
    const bounds = nodeBounds({ position: { x: 0, y: 0 }, width: 30, height: 40 })
    expect(bounds).toEqual({ x: 0, y: 0, width: 30, height: 40 })
  })

  it('falls back to default dimensions when nothing is provided', () => {
    const bounds = nodeBounds({ position: { x: 5, y: 5 } })
    expect(bounds).toEqual({ x: 5, y: 5, width: 100, height: 40 })
  })
})

describe('unionBounds', () => {
  it('returns a zero box for an empty list', () => {
    expect(unionBounds([])).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })

  it('unions two overlapping boxes', () => {
    const bounds = unionBounds([
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 5, y: 5, width: 10, height: 10 },
    ])
    expect(bounds).toEqual({ x: 0, y: 0, width: 15, height: 15 })
  })
})

describe('gapAlignedCuts', () => {
  it('returns [] for an empty box list', () => {
    expect(gapAlignedCuts([], 50)).toEqual([])
  })

  it('returns [] when content already fits within the strip', () => {
    expect(gapAlignedCuts([{ x: 0, y: 0, width: 10, height: 1 }], 50)).toEqual([])
  })

  it('merges overlapping element boxes into one interval before cutting', () => {
    const boxes = [
      { x: 0, y: 0, width: 20, height: 1 },
      { x: 10, y: 0, width: 20, height: 1 },
      { x: 100, y: 0, width: 10, height: 1 },
    ]
    expect(gapAlignedCuts(boxes, 60)).toEqual([60])
  })

  it('cuts at gap boundaries for ordinary multi-element content', () => {
    const boxes = [
      { x: 0, y: 0, width: 10, height: 1 },
      { x: 100, y: 0, width: 10, height: 1 },
      { x: 200, y: 0, width: 10, height: 1 },
    ]
    expect(gapAlignedCuts(boxes, 60)).toEqual([60, 120, 180])
  })

  it('lets a single element wider than the strip overflow its own band (chosen undefined path)', () => {
    const boxes = [
      { x: 0, y: 0, width: 200, height: 1 },
      { x: 250, y: 0, width: 10, height: 1 },
    ]
    expect(gapAlignedCuts(boxes, 50)).toEqual([250])
  })

  it('jumps to the next gap end when the same gap would repeat (chosen <= segStart fallback)', () => {
    const boxes = [
      { x: 9, y: 0, width: 1, height: 1 },
      { x: 20, y: 0, width: 6, height: 1 },
      { x: 1000, y: 0, width: 1, height: 1 },
    ]
    expect(gapAlignedCuts(boxes, 5)).toEqual([14, 19, 20, 1000])
  })
})

describe('dedupeBoundaries', () => {
  it('drops consecutive duplicates', () => {
    expect(dedupeBoundaries([0, 10, 10, 20, 20, 20, 30])).toEqual([0, 10, 20, 30])
  })

  it('keeps a single value untouched', () => {
    expect(dedupeBoundaries([5])).toEqual([5])
  })
})

describe('scaleToFitWidth', () => {
  it('returns 1 for zero or negative content width', () => {
    expect(scaleToFitWidth(0, 100)).toBe(1)
    expect(scaleToFitWidth(-5, 100)).toBe(1)
  })

  it('scales down to fit the strip', () => {
    expect(scaleToFitWidth(200, 100)).toBe(0.5)
  })

  it('never scales up past 1', () => {
    expect(scaleToFitWidth(50, 200)).toBe(1)
  })
})

describe('scaleToFitBothAxes', () => {
  it('returns 1 for zero or negative content width/height', () => {
    expect(scaleToFitBothAxes(0, 100, 100, 100)).toBe(1)
    expect(scaleToFitBothAxes(100, 0, 100, 100)).toBe(1)
  })

  it('scales down by the more constrained axis', () => {
    expect(scaleToFitBothAxes(400, 100, 100, 100)).toBe(0.25)
    expect(scaleToFitBothAxes(100, 400, 100, 100)).toBe(0.25)
  })

  it('never scales up past 1', () => {
    expect(scaleToFitBothAxes(50, 50, 200, 200)).toBe(1)
  })
})

describe('composeTransforms', () => {
  it('composes offsets and scale, inner offset scaled by outer scale', () => {
    const result = composeTransforms({ dx: 10, dy: 20, scale: 2 }, { dx: 5, dy: 5, scale: 0.5 })
    expect(result).toEqual({ dx: 20, dy: 30, scale: 1 })
  })
})

describe('transformDrawOp / transformDrawOps', () => {
  const t = { dx: 10, dy: 20, scale: 2 }

  it('transforms a line op', () => {
    const op: DrawOp = { kind: 'line', x1: 1, y1: 1, x2: 2, y2: 2, color: '#000000', widthPt: 1 }
    expect(transformDrawOp(op, t)).toEqual({
      kind: 'line',
      x1: 12,
      y1: 22,
      x2: 14,
      y2: 24,
      color: '#000000',
      widthPt: 2,
    })
  })

  it('transforms a rect op with strokeWidthPt', () => {
    const op: DrawOp = { kind: 'rect', x: 1, y: 1, width: 4, height: 4, stroke: '#111111', strokeWidthPt: 1 }
    expect(transformDrawOp(op, t)).toEqual({
      kind: 'rect',
      x: 12,
      y: 22,
      width: 8,
      height: 8,
      stroke: '#111111',
      strokeWidthPt: 2,
    })
  })

  it('transforms a rect op without strokeWidthPt', () => {
    const op: DrawOp = { kind: 'rect', x: 0, y: 0, width: 1, height: 1, fill: '#222222' }
    const result = transformDrawOp(op, t) as Extract<DrawOp, { kind: 'rect' }>
    expect(result.strokeWidthPt).toBeUndefined()
  })

  it('transforms a path op with scale and strokeWidthPt', () => {
    const op: DrawOp = { kind: 'path', d: 'M0 0', x: 1, y: 1, scale: 2, stroke: '#333333', strokeWidthPt: 1 }
    const result = transformDrawOp(op, t) as Extract<DrawOp, { kind: 'path' }>
    expect(result).toEqual({ kind: 'path', d: 'M0 0', x: 12, y: 22, scale: 4, stroke: '#333333', strokeWidthPt: 2 })
  })

  it('transforms a path op with no explicit scale/strokeWidthPt (defaults to 1 / undefined)', () => {
    const op: DrawOp = { kind: 'path', d: 'M0 0', x: 0, y: 0, fill: '#444444' }
    const result = transformDrawOp(op, t) as Extract<DrawOp, { kind: 'path' }>
    expect(result.scale).toBe(2)
    expect(result.strokeWidthPt).toBeUndefined()
  })

  it('transforms a text op', () => {
    const op: DrawOp = { kind: 'text', text: 'hi', x: 1, y: 1, sizePt: 10, color: '#000000', font: 'sans' }
    expect(transformDrawOp(op, t)).toEqual({
      kind: 'text',
      text: 'hi',
      x: 12,
      y: 22,
      sizePt: 20,
      color: '#000000',
      font: 'sans',
    })
  })

  it('transforms a clipPush op', () => {
    const op: DrawOp = { kind: 'clipPush', x: 1, y: 1, width: 2, height: 2 }
    expect(transformDrawOp(op, t)).toEqual({ kind: 'clipPush', x: 12, y: 22, width: 4, height: 4 })
  })

  it('passes a clipPop op through unchanged', () => {
    const op: DrawOp = { kind: 'clipPop' }
    expect(transformDrawOp(op, t)).toEqual({ kind: 'clipPop' })
  })

  it('transformDrawOps maps over a list of ops', () => {
    const ops: DrawOp[] = [
      { kind: 'clipPop' },
      { kind: 'text', text: 'a', x: 0, y: 0, sizePt: 1, color: '#000', font: 'sans' },
    ]
    const result = transformDrawOps(ops, t)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ kind: 'clipPop' })
  })

  it('the switch is exhaustive over every real DrawOp kind — an unknown kind hits the never-typed default', () => {
    // Deliberately invalid input to exercise the defensive exhaustiveness
    // check; DrawOp itself has no such variant, so this cannot happen at runtime.
    // @ts-expect-error -- intentionally invalid `kind` to hit the exhaustive-switch default
    const bogus: DrawOp = { kind: 'bogus' }
    expect(transformDrawOp(bogus, t)).toBe(bogus)
  })
})
