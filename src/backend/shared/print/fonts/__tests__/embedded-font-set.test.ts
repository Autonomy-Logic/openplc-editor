import { getEmbeddedFontSet } from '../embedded-font-set'

describe('getEmbeddedFontSet', () => {
  it('decodes all four embedded fonts to non-empty byte arrays', () => {
    const fonts = getEmbeddedFontSet()

    expect(fonts.sans.length).toBeGreaterThan(0)
    expect(fonts.sansBold.length).toBeGreaterThan(0)
    expect(fonts.mono.length).toBeGreaterThan(0)
    expect(fonts.monoBold.length).toBeGreaterThan(0)
  })

  it('caches the decoded set across calls', () => {
    expect(getEmbeddedFontSet()).toBe(getEmbeddedFontSet())
  })
})
