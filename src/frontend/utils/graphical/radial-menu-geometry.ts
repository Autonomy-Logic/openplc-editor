/**
 * Pure geometry helpers for the radial (pie) menu.
 *
 * Angles are in radians, measured in screen space (y grows downwards), so a
 * positive sweep is clockwise. Slice 0 is centred on the top of the circle.
 */

export type Point = { x: number; y: number }

export type SliceAngles = { start: number; end: number; mid: number }

export const RADIAL_MENU_INNER_RADIUS = 44
export const RADIAL_MENU_OUTER_RADIUS = 112
export const RADIAL_MENU_SLICE_GAP = 0.03

const TWO_PI = Math.PI * 2
const TOP = -Math.PI / 2

const polar = (radius: number, angle: number): Point => ({
  x: radius * Math.cos(angle),
  y: radius * Math.sin(angle),
})

const fmt = (value: number): string => {
  const rounded = Math.round(value * 1000) / 1000
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

/** Angular span of a slice. Throws when `count` is not a positive integer or `index` is out of range. */
export function getSliceAngles(index: number, count: number): SliceAngles {
  if (!Number.isInteger(count) || count < 1) throw new RangeError(`Invalid slice count: ${count}`)
  if (!Number.isInteger(index) || index < 0 || index >= count) throw new RangeError(`Invalid slice index: ${index}`)
  const step = TWO_PI / count
  const mid = TOP + index * step
  return { start: mid - step / 2, end: mid + step / 2, mid }
}

/** Point at the angular middle of a slice, at the given radius from the centre. */
export function getSliceAnchor(index: number, count: number, radius: number): Point {
  return polar(radius, getSliceAngles(index, count).mid)
}

/**
 * SVG path of an annular sector centred on (0, 0). A single slice is drawn as
 * a full ring made of two half arcs, because one arc cannot span 2π.
 */
export function describeSlicePath(
  index: number,
  count: number,
  innerRadius: number = RADIAL_MENU_INNER_RADIUS,
  outerRadius: number = RADIAL_MENU_OUTER_RADIUS,
  gap: number = RADIAL_MENU_SLICE_GAP,
): string {
  const { start, end } = getSliceAngles(index, count)

  if (count === 1) {
    const o1 = polar(outerRadius, start)
    const o2 = polar(outerRadius, start + Math.PI)
    const i1 = polar(innerRadius, start)
    const i2 = polar(innerRadius, start + Math.PI)
    return [
      `M ${fmt(o1.x)} ${fmt(o1.y)}`,
      `A ${outerRadius} ${outerRadius} 0 1 1 ${fmt(o2.x)} ${fmt(o2.y)}`,
      `A ${outerRadius} ${outerRadius} 0 1 1 ${fmt(o1.x)} ${fmt(o1.y)}`,
      `M ${fmt(i1.x)} ${fmt(i1.y)}`,
      `A ${innerRadius} ${innerRadius} 0 1 0 ${fmt(i2.x)} ${fmt(i2.y)}`,
      `A ${innerRadius} ${innerRadius} 0 1 0 ${fmt(i1.x)} ${fmt(i1.y)}`,
      'Z',
    ].join(' ')
  }

  const a0 = start + gap / 2
  const a1 = end - gap / 2
  const largeArc = a1 - a0 > Math.PI ? 1 : 0
  const outerStart = polar(outerRadius, a0)
  const outerEnd = polar(outerRadius, a1)
  const innerEnd = polar(innerRadius, a1)
  const innerStart = polar(innerRadius, a0)

  return [
    `M ${fmt(outerStart.x)} ${fmt(outerStart.y)}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${fmt(outerEnd.x)} ${fmt(outerEnd.y)}`,
    `L ${fmt(innerEnd.x)} ${fmt(innerEnd.y)}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${fmt(innerStart.x)} ${fmt(innerStart.y)}`,
    'Z',
  ].join(' ')
}

/**
 * Index of the slice under a point given relative to the menu centre, or
 * `null` when the point is in the hole or outside the ring.
 */
export function getSliceIndexAtPoint(
  point: Point,
  count: number,
  innerRadius: number = RADIAL_MENU_INNER_RADIUS,
  outerRadius: number = RADIAL_MENU_OUTER_RADIUS,
): number | null {
  if (!Number.isInteger(count) || count < 1) return null
  const distance = Math.hypot(point.x, point.y)
  if (distance < innerRadius || distance > outerRadius) return null
  if (count === 1) return 0

  const step = TWO_PI / count
  const angle = Math.atan2(point.y, point.x)
  const relative = (((angle - TOP + step / 2) % TWO_PI) + TWO_PI) % TWO_PI
  return Math.floor(relative / step) % count
}

/** Moves a menu centre so that a circle of `radius` stays fully inside the viewport. */
export function clampMenuCenter(
  center: Point,
  radius: number,
  viewport: { width: number; height: number },
  margin: number = 8,
): Point {
  const clampAxis = (value: number, size: number): number => {
    const min = radius + margin
    const max = size - radius - margin
    if (max < min) return size / 2
    return Math.min(Math.max(value, min), max)
  }
  return { x: clampAxis(center.x, viewport.width), y: clampAxis(center.y, viewport.height) }
}
