import { WIDE_CODE_POINT_RANGES } from './wide-ranges'

/** Advance width of every JetBrains Mono glyph, in em, the same in all weights. */
export const JETBRAINS_MONO_ADVANCE_EM = 0.6

/** True when the code point is East Asian Width W or F, or has Emoji_Presentation; binary search of the range table. */
export function isWideCodePoint(codePoint: number): boolean {
  let low = 0
  let high = WIDE_CODE_POINT_RANGES.length - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    const [first, last] = WIDE_CODE_POINT_RANGES[middle]
    if (codePoint < first) high = middle - 1
    else if (codePoint > last) low = middle + 1
    else return true
  }
  return false
}

/** Character cells of a string: 2 for Unicode East Asian Width W or F and Emoji_Presentation, else 1; counted per code point. */
export function textCells(text: string): number {
  let cells = 0
  for (const character of text) {
    cells += isWideCodePoint(character.codePointAt(0) ?? 0) ? 2 : 1
  }
  return cells
}

/** Width in px of text drawn in JetBrains Mono at sizePx: textCells(text) * 0.6 * sizePx. Weight does not change it. */
export function textWidthPx(text: string, sizePx: number): number {
  return textCells(text) * JETBRAINS_MONO_ADVANCE_EM * sizePx
}
