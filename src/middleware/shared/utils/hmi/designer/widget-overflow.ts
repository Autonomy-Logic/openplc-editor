/** How far a widget's drawing reaches past the box it is given. */
import type { HmiPreviewRect } from '../../../ports/hmi-preview-types'

/** Drawing within this many logical units past the box counts as inside: anti-aliasing and rounding. */
const TOLERANCE = 1

/**
 * Where a drawing reaches past a box, as "15 lu to the left, 30 lu below", or null when it stays inside.
 */
export function widgetOverflow(drawn: HmiPreviewRect | null, box: HmiPreviewRect): string | null {
  if (!drawn) return null
  const sides: Array<[number, string]> = [
    [box.x - drawn.x, 'to the left'],
    [drawn.x + drawn.width - (box.x + box.width), 'to the right'],
    [box.y - drawn.y, 'above'],
    [drawn.y + drawn.height - (box.y + box.height), 'below'],
  ]
  const past = sides.filter(([by]) => by > TOLERANCE).map(([by, where]) => `${Math.round(by)} lu ${where}`)
  return past.length > 0 ? past.join(', ') : null
}
