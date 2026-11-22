import { isWideCodePoint, JETBRAINS_MONO_ADVANCE_EM, textCells, textWidthPx } from '../measure'

describe('textCells', () => {
  it('counts one cell per narrow character', () => {
    expect(textCells('Start')).toBe(5)
  })

  it('counts nothing for an empty string', () => {
    expect(textCells('')).toBe(0)
  })

  it('counts two cells for each CJK character and one for the underscore', () => {
    expect(textCells('ポンプ_起動')).toBe(11)
  })

  it('counts two cells for a Hangul syllable', () => {
    expect(textCells('한')).toBe(2)
  })

  it('counts two cells for a fullwidth form (East Asian Width F)', () => {
    expect(textCells('Ａ')).toBe(2)
  })

  it('counts one cell for a halfwidth katakana (East Asian Width H)', () => {
    expect(textCells('ｱ')).toBe(1)
  })

  it('counts two cells for an emoji with Emoji_Presentation in the BMP', () => {
    expect(textCells('☕')).toBe(2)
  })

  it('counts two cells for an astral emoji, which is one code point and two UTF-16 units', () => {
    expect(textCells('🚀')).toBe(2)
  })

  it('counts one cell for a narrow astral character, per code point and not per UTF-16 unit', () => {
    expect(textCells('𝐀')).toBe(1)
  })

  it('counts two cells for a wide astral ideograph', () => {
    expect(textCells('𠀀')).toBe(2)
  })

  it('counts a combining mark as its own code point, one cell', () => {
    expect(textCells('é')).toBe(2)
  })

  it('adds the cells of mixed narrow and wide characters', () => {
    expect(textCells('Pump🚀1')).toBe(7)
  })
})

describe('textWidthPx', () => {
  it('is the cell count times 0.6 em at the given size', () => {
    expect(textWidthPx('ABC', 12)).toBeCloseTo(21.6, 10)
  })

  it('doubles the width of a wide character', () => {
    expect(textWidthPx('起', 10)).toBeCloseTo(12, 10)
  })

  it('is zero for an empty string', () => {
    expect(textWidthPx('', 12)).toBe(0)
  })

  it('scales linearly with the font size', () => {
    expect(textWidthPx('Start', 10)).toBeCloseTo(30, 10)
    expect(textWidthPx('Start', 20)).toBeCloseTo(60, 10)
  })

  it('uses the JetBrains Mono advance of 0.6 em', () => {
    expect(JETBRAINS_MONO_ADVANCE_EM).toBe(0.6)
  })
})

describe('isWideCodePoint', () => {
  it.each([
    ['Latin A', 0x41],
    ['underscore', 0x5f],
    ['combining acute accent', 0x301],
    ['halfwidth katakana A', 0xff71],
    ['Hangul jungseong filler (East Asian Width N)', 0x1160],
    ['mathematical bold capital A', 0x1d400],
  ])('is false for %s', (_label, codePoint) => {
    expect(isWideCodePoint(codePoint)).toBe(false)
  })

  it.each([
    ['CJK ideograph', 0x4e00],
    ['katakana PO', 0x30dd],
    ['ideographic space (East Asian Width F)', 0x3000],
    ['fullwidth Latin A', 0xff21],
    ['Hangul choseong kiyeok', 0x1100],
    ['first Hangul syllable', 0xac00],
    ['last Hangul syllable', 0xd7a3],
    ['hot beverage emoji', 0x2615],
    ['grinning face emoji', 0x1f600],
    ['rocket emoji', 0x1f680],
    ['regional indicator A (Emoji_Presentation, East Asian Width N)', 0x1f1e6],
    ['CJK extension B ideograph', 0x20000],
  ])('is true for %s', (_label, codePoint) => {
    expect(isWideCodePoint(codePoint)).toBe(true)
  })
})
