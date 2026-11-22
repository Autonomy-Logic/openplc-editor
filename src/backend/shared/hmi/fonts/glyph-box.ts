/**
 * Bounds of the glyph bitmaps a face can produce, from each glyph's box in the font's `glyf` table, so a text size is
 * checked against the glyphs that exist rather than against the font's overall bounding box.
 */

/** Units per em and the size of every non-empty glyph box, in font units. */
export interface HmiFontBoxes {
  unitsPerEm: number
  boxes: ReadonlyArray<{ width: number; height: number }>
}

/** Offsets of a TrueType font's tables by tag. */
function tables(view: DataView): Map<string, number> {
  const found = new Map<string, number>()
  const count = view.getUint16(4)
  for (let i = 0; i < count; i++) {
    const record = 12 + i * 16
    const tag = String.fromCharCode(
      view.getUint8(record),
      view.getUint8(record + 1),
      view.getUint8(record + 2),
      view.getUint8(record + 3),
    )
    found.set(tag, view.getUint32(record + 8))
  }
  return found
}

/** Glyph boxes of a TrueType font; throws when it lacks the head, maxp, loca or glyf table. */
export function hmiFontBoxes(ttf: Uint8Array): HmiFontBoxes {
  const view = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength)
  const at = tables(view)
  const head = at.get('head')
  const maxp = at.get('maxp')
  const loca = at.get('loca')
  const glyf = at.get('glyf')
  if (head === undefined || maxp === undefined || loca === undefined || glyf === undefined)
    throw new Error('the font has no glyph outlines (head, maxp, loca and glyf tables)')
  const longOffsets = view.getInt16(head + 50) === 1
  const glyphs = view.getUint16(maxp + 4)
  const offset = (i: number): number => (longOffsets ? view.getUint32(loca + i * 4) : view.getUint16(loca + i * 2) * 2)
  const boxes: Array<{ width: number; height: number }> = []
  for (let i = 0; i < glyphs; i++) {
    const start = offset(i)
    if (offset(i + 1) === start) continue
    const g = glyf + start
    boxes.push({
      width: view.getInt16(g + 6) - view.getInt16(g + 2),
      height: view.getInt16(g + 8) - view.getInt16(g + 4),
    })
  }
  return { unitsPerEm: view.getUint16(head + 18), boxes }
}

/**
 * Most pixels of one glyph bitmap of a face at a text size in screen units, drawn at density pixels per unit: each
 * glyph box scaled as the core scales it, plus one pixel per side for the sub-pixel shift.
 */
export function hmiGlyphPixels(font: HmiFontBoxes, size: number, density: number): number {
  const scale = (size * density) / font.unitsPerEm
  let most = 0
  for (const b of font.boxes)
    most = Math.max(most, (Math.ceil(b.width * scale) + 1) * (Math.ceil(b.height * scale) + 1))
  return most
}

/** Largest whole text size in screen units whose glyphs all fit maxPixels at density; 0 when none does. */
export function hmiLargestTextSize(font: HmiFontBoxes, density: number, maxPixels: number): number {
  let lo = 0
  let hi = 4096
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (hmiGlyphPixels(font, mid, density) <= maxPixels) lo = mid
    else hi = mid - 1
  }
  return lo
}
