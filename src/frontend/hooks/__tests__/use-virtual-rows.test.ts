import { computeRowRange } from '../use-virtual-rows'

const ROW = 32
const OVERSCAN = 5

describe('computeRowRange', () => {
  it('starts at the first row at the top of the scroll', () => {
    expect(computeRowRange({ scrollTop: 0, clientHeight: 320, offsetTop: 0 }, 1000, ROW, OVERSCAN)).toEqual({
      start: 0,
      end: 15,
    })
  })

  it('covers the viewport plus the overscan in the middle of the scroll', () => {
    expect(computeRowRange({ scrollTop: 3200, clientHeight: 320, offsetTop: 0 }, 1000, ROW, OVERSCAN)).toEqual({
      start: 95,
      end: 115,
    })
  })

  it('clamps the window to the last row at the end of the scroll', () => {
    expect(computeRowRange({ scrollTop: 31680, clientHeight: 320, offsetTop: 0 }, 1000, ROW, OVERSCAN)).toEqual({
      start: 985,
      end: 1000,
    })
  })

  it('subtracts the content above the first row', () => {
    expect(computeRowRange({ scrollTop: 3264, clientHeight: 320, offsetTop: 64 }, 1000, ROW, OVERSCAN)).toEqual({
      start: 95,
      end: 115,
    })
  })

  it('keeps the window inside a list shorter than the viewport', () => {
    expect(computeRowRange({ scrollTop: 0, clientHeight: 3200, offsetTop: 0 }, 12, ROW, OVERSCAN)).toEqual({
      start: 0,
      end: 12,
    })
  })

  it('returns an empty window for an empty list', () => {
    expect(computeRowRange({ scrollTop: 0, clientHeight: 320, offsetTop: 0 }, 0, ROW, OVERSCAN)).toEqual({
      start: 0,
      end: 0,
    })
  })
})
