/**
 * Text measuring/wrapping helpers that work without font metrics.
 *
 * The print engine is DOM-free and paginates *before* any font is embedded, so
 * exact advance widths are not available while layout is being decided. For
 * wrapping (comments, rung notes) a per-character width estimate is enough:
 * CJK/full-width characters occupy one em, everything else roughly half an em.
 * Every estimated measure is used only to pick line breaks — the glyphs are
 * still positioned by the renderers' own column math.
 */

/** Code-point ranges that render one em wide (CJK, kana, hangul, full-width forms). */
export function isWideCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) || // Hangul Jamo
    (codePoint >= 0x2e80 && codePoint <= 0x303e) || // CJK radicals, Kangxi, CJK punctuation
    (codePoint >= 0x3041 && codePoint <= 0x33ff) || // Kana + CJK compatibility
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) || // CJK extension A
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) || // CJK unified ideographs
    (codePoint >= 0xa000 && codePoint <= 0xa4cf) || // Yi
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) || // Hangul syllables
    (codePoint >= 0xf900 && codePoint <= 0xfaff) || // CJK compatibility ideographs
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) || // CJK compatibility forms
    (codePoint >= 0xff00 && codePoint <= 0xff60) || // Full-width forms
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd) // CJK extensions B and beyond
  )
}

/**
 * What the bundled Latin faces can be relied on to draw: ASCII/Latin, Greek,
 * Cyrillic, general punctuation, arrows, maths, box drawing and geometric
 * shapes. Everything else — CJK, but also ℃, emoji and other symbol blocks —
 * has to come from the fallback face or it renders as .notdef.
 */
export function isLatinCoveredCodePoint(codePoint: number): boolean {
  if (codePoint > 0x2e7f) return false
  return (
    codePoint <= 0x024f || // Basic Latin + Latin-1 supplement + Latin extended A/B
    (codePoint >= 0x0370 && codePoint <= 0x052f) || // Greek + Cyrillic
    (codePoint >= 0x2000 && codePoint <= 0x20bf) || // General punctuation, currency
    (codePoint >= 0x2190 && codePoint <= 0x22ff) || // Arrows, mathematical operators
    (codePoint >= 0x2500 && codePoint <= 0x25ff) // Box drawing, block elements, geometric shapes
  )
}

/** True when any character needs the fallback face (CJK, symbols outside the Latin coverage, emoji). */
export function needsFallbackFont(text: string): boolean {
  for (const char of text) {
    if (!isLatinCoveredCodePoint(char.codePointAt(0) ?? 0)) return true
  }
  return false
}

/** True when `text` contains at least one character the Latin fonts can't draw. */
export function containsWideChar(text: string): boolean {
  return needsFallbackFont(text)
}

/** A character occupies two monospace cells when it is wide, or when it has to come from the fallback face. */
export function occupiesTwoCells(codePoint: number): boolean {
  return isWideCodePoint(codePoint) || !isLatinCoveredCodePoint(codePoint)
}

const NARROW_EM = 0.52
const WIDE_EM = 1

/** Estimated advance of `text` in points at `sizePt`. */
export function estimateTextWidthPt(text: string, sizePt: number): number {
  let em = 0
  for (const char of text) {
    if (char === '\t') em += NARROW_EM * 4
    else em += occupiesTwoCells(char.codePointAt(0) ?? 0) ? WIDE_EM : NARROW_EM
  }
  return em * sizePt
}

/** Display columns, counting every wide character as two — the monospace layout's own unit. */
export function displayColumns(text: string): number {
  let columns = 0
  for (const char of text) {
    columns += occupiesTwoCells(char.codePointAt(0) ?? 0) ? 2 : 1
  }
  return columns
}

/** Splits `text` at a column budget, counting wide characters as two columns. */
export function sliceByColumns(text: string, maxColumns: number): [string, string] {
  if (maxColumns <= 0) return ['', text]
  let columns = 0
  let index = 0
  for (const char of text) {
    const width = occupiesTwoCells(char.codePointAt(0) ?? 0) ? 2 : 1
    if (columns + width > maxColumns) break
    columns += width
    index += char.length
  }
  return [text.slice(0, index), text.slice(index)]
}

/**
 * Hard-wraps plain text to `maxWidthPt`, preferring to break at spaces for
 * Latin and breaking anywhere for wide characters (which is how CJK wraps).
 * Used for rung comments and FBD comment boxes, neither of which had any
 * wrapping before — a long comment simply ran off the page.
 */
export function wrapPlainText(text: string, maxWidthPt: number, sizePt: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    if (estimateTextWidthPt(paragraph, sizePt) <= maxWidthPt) {
      lines.push(paragraph)
      continue
    }
    let rest = paragraph
    while (rest.length > 0 && estimateTextWidthPt(rest, sizePt) > maxWidthPt) {
      let cut = 0
      let width = 0
      let lastSpace = -1
      for (const char of rest) {
        const em = isWideCodePoint(char.codePointAt(0) ?? 0) ? WIDE_EM : NARROW_EM
        if (width + em * sizePt > maxWidthPt) break
        width += em * sizePt
        cut += char.length
        if (char === ' ') lastSpace = cut
      }
      // Never cut mid-word for Latin text when a space is available; CJK has no
      // spaces, so the character boundary is the correct break there.
      const breakAt = lastSpace > 0 && !containsWideChar(rest.slice(0, cut)) ? lastSpace : cut
      if (breakAt <= 0) break
      lines.push(rest.slice(0, breakAt).trimEnd())
      rest = rest.slice(breakAt)
    }
    if (rest.length > 0) lines.push(rest)
  }
  return lines.length > 0 ? lines : ['']
}
