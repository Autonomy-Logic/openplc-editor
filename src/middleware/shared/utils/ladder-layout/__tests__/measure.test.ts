import { isWideCodePoint, JETBRAINS_MONO_ADVANCE_EM, textCells, textWidthPx } from '../measure'

describe('text measurement', () => {
  it('counts one cell per narrow code point and two per wide one', () => {
    expect(textCells('')).toBe(0)
    expect(textCells('Start')).toBe(5)
    expect(textCells('ポンプ_起動')).toBe(11)
    expect(textCells('a\u{1F600}')).toBe(3)
    expect(isWideCodePoint(0xff71)).toBe(false)
    expect(isWideCodePoint(0x20000)).toBe(true)
  })

  it('is the cell count times the JetBrains Mono advance at the given size', () => {
    expect(textWidthPx('Start', 12)).toBeCloseTo(5 * JETBRAINS_MONO_ADVANCE_EM * 12)
    expect(textWidthPx('起', 10)).toBeCloseTo(2 * JETBRAINS_MONO_ADVANCE_EM * 10)
  })
})
