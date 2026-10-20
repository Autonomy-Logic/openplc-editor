import {
  clampMenuCenter,
  describeSlicePath,
  getSliceAnchor,
  getSliceAngles,
  getSliceIndexAtPoint,
  RADIAL_MENU_INNER_RADIUS,
  RADIAL_MENU_OUTER_RADIUS,
} from '../radial-menu-geometry'

describe('radial-menu-geometry', () => {
  describe('getSliceAngles', () => {
    it('centres slice 0 on the top of the circle', () => {
      const { start, end, mid } = getSliceAngles(0, 4)
      expect(mid).toBeCloseTo(-Math.PI / 2)
      expect(start).toBeCloseTo(-Math.PI / 2 - Math.PI / 4)
      expect(end).toBeCloseTo(-Math.PI / 2 + Math.PI / 4)
    })

    it('advances clockwise', () => {
      expect(getSliceAngles(1, 4).mid).toBeCloseTo(0)
      expect(getSliceAngles(2, 4).mid).toBeCloseTo(Math.PI / 2)
    })

    it('rejects invalid counts and indexes', () => {
      expect(() => getSliceAngles(0, 0)).toThrow(RangeError)
      expect(() => getSliceAngles(0, 1.5)).toThrow(RangeError)
      expect(() => getSliceAngles(3, 3)).toThrow(RangeError)
      expect(() => getSliceAngles(-1, 3)).toThrow(RangeError)
    })
  })

  describe('getSliceAnchor', () => {
    it('returns the point at the middle angle of the slice', () => {
      const top = getSliceAnchor(0, 4, 10)
      expect(top.x).toBeCloseTo(0)
      expect(top.y).toBeCloseTo(-10)
      const right = getSliceAnchor(1, 4, 10)
      expect(right.x).toBeCloseTo(10)
      expect(right.y).toBeCloseTo(0)
    })
  })

  describe('describeSlicePath', () => {
    it('draws a closed annular sector', () => {
      const path = describeSlicePath(0, 3, 10, 20, 0)
      expect(path.startsWith('M ')).toBe(true)
      expect(path.endsWith('Z')).toBe(true)
      expect(path.match(/A /g)).toHaveLength(2)
      expect(path).toContain(' L ')
    })

    it('uses the small-arc flag for slices under half a turn', () => {
      expect(describeSlicePath(0, 3, 10, 20, 0)).toContain('A 20 20 0 0 1')
    })

    it('uses the large-arc flag for slices over half a turn', () => {
      expect(describeSlicePath(0, 2, 10, 20, -0.5)).toContain('A 20 20 0 1 1')
    })

    it('draws a full ring for a single slice', () => {
      const path = describeSlicePath(0, 1, 10, 20)
      expect(path.match(/A /g)).toHaveLength(4)
      expect(path).not.toContain('-0 ')
    })

    it('falls back to the default radii', () => {
      expect(describeSlicePath(0, 4)).toContain(`A ${RADIAL_MENU_OUTER_RADIUS} ${RADIAL_MENU_OUTER_RADIUS}`)
      expect(describeSlicePath(0, 4)).toContain(`A ${RADIAL_MENU_INNER_RADIUS} ${RADIAL_MENU_INNER_RADIUS}`)
    })
  })

  describe('getSliceIndexAtPoint', () => {
    it('maps directions to slices for a three-slice menu', () => {
      expect(getSliceIndexAtPoint({ x: 0, y: -60 }, 3)).toBe(0)
      expect(getSliceIndexAtPoint({ x: 60, y: 30 }, 3)).toBe(1)
      expect(getSliceIndexAtPoint({ x: -60, y: 30 }, 3)).toBe(2)
    })

    it('maps directions to slices for a six-slice menu', () => {
      for (let index = 0; index < 6; index++) {
        const anchor = getSliceAnchor(index, 6, 70)
        expect(getSliceIndexAtPoint(anchor, 6)).toBe(index)
      }
    })

    it('ignores the hole and the outside of the ring', () => {
      expect(getSliceIndexAtPoint({ x: 0, y: -10 }, 3)).toBeNull()
      expect(getSliceIndexAtPoint({ x: 0, y: -500 }, 3)).toBeNull()
    })

    it('returns 0 for a single slice and null for an invalid count', () => {
      expect(getSliceIndexAtPoint({ x: 70, y: 0 }, 1)).toBe(0)
      expect(getSliceIndexAtPoint({ x: 70, y: 0 }, 0)).toBeNull()
    })

    it('honours custom radii', () => {
      expect(getSliceIndexAtPoint({ x: 0, y: -5 }, 3, 2, 8)).toBe(0)
    })
  })

  describe('clampMenuCenter', () => {
    const viewport = { width: 800, height: 600 }

    it('keeps a centre that already fits', () => {
      expect(clampMenuCenter({ x: 400, y: 300 }, 100, viewport)).toEqual({ x: 400, y: 300 })
    })

    it('pushes the centre away from the edges', () => {
      expect(clampMenuCenter({ x: 5, y: 595 }, 100, viewport)).toEqual({ x: 108, y: 492 })
      expect(clampMenuCenter({ x: 795, y: 0 }, 100, viewport, 0)).toEqual({ x: 700, y: 100 })
    })

    it('centres the menu when the viewport is smaller than the menu', () => {
      expect(clampMenuCenter({ x: 10, y: 10 }, 100, { width: 150, height: 150 })).toEqual({ x: 75, y: 75 })
    })
  })
})
