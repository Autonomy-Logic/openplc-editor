import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

import { hmiFontBoxes, hmiGlyphPixels, hmiLargestTextSize } from '../glyph-box'

/* The bundled fonts: resources/sources/hmi/fonts in the editor, src/assets/firmware/hmi/fonts on the web. */
const FONT_DIR =
  ['resources/sources/hmi/fonts', 'src/assets/firmware/hmi/fonts']
    .map((dir) => join(process.cwd(), dir))
    .find((dir) => existsSync(dir)) ?? 'missing-hmi-fonts'

const font = (file: string) => hmiFontBoxes(new Uint8Array(readFileSync(join(FONT_DIR, file))))

describe('glyph boxes', () => {
  it('reads every outlined glyph of a bundled font', () => {
    const regular = font('OpenPLCSans-Regular.ttf')
    expect(regular.unitsPerEm).toBe(2048)
    expect(regular.boxes.length).toBe(203)
  })

  it('finds the largest text size whose glyphs all fit a buffer, per density', () => {
    const regular = font('OpenPLCSans-Regular.ttf')
    expect(hmiLargestTextSize(regular, 1, 8192)).toBe(104)
    expect(hmiLargestTextSize(regular, 2, 8192)).toBe(52)
    expect(hmiGlyphPixels(regular, 104, 1)).toBeLessThanOrEqual(8192)
    expect(hmiGlyphPixels(regular, 105, 1)).toBeGreaterThan(8192)
    expect(hmiLargestTextSize(font('LiberationSans-Bold.ttf'), 1, 8192)).toBe(80)
  })

  it('refuses a file without glyph outlines', () => {
    expect(() => hmiFontBoxes(new Uint8Array(12))).toThrow('the font has no glyph outlines')
  })
})
