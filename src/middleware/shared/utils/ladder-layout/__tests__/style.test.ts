import { LADDER_PALETTE, LADDER_STYLE, LADDER_TYPOGRAPHY } from '../style'

describe('LADDER_STYLE', () => {
  it('holds the approved prototype spacing values exactly', () => {
    expect(LADDER_STYLE).toEqual({
      sym: 22,
      symH: 14,
      gap: 12,
      gapBlk: 14,
      labGap: 4,
      branchGap: 12,
      parPad: 8,
      P: 18,
      blkHead: 19,
      blkBot: 4,
      blkPad: 7,
      blkMid: 22,
      stub: 12,
      gutter: 44,
      padR: 24,
      padT: 8,
      padB: 12,
      commentH: 22,
      topPad: 6,
    })
  })
})

describe('LADDER_TYPOGRAPHY', () => {
  it('draws in JetBrains Mono with monospace fallbacks', () => {
    expect(LADDER_TYPOGRAPHY.family).toBe("'JetBrains Mono', ui-monospace, Menlo, monospace")
  })

  it('draws names, pin variables and comments at 12 px and locations at 10 px', () => {
    expect(LADDER_TYPOGRAPHY.nameSizePx).toBe(12)
    expect(LADDER_TYPOGRAPHY.commentSizePx).toBe(12)
    expect(LADDER_TYPOGRAPHY.locationSizePx).toBe(10)
    expect(LADDER_TYPOGRAPHY.pinFormalSizePx).toBe(11)
  })

  it('uses weight 400 for regular text and 600 for the block type', () => {
    expect(LADDER_TYPOGRAPHY.regularWeight).toBe(400)
    expect(LADDER_TYPOGRAPHY.semiboldWeight).toBe(600)
  })

  it('has exactly the specified fields', () => {
    expect(LADDER_TYPOGRAPHY).toEqual({
      family: "'JetBrains Mono', ui-monospace, Menlo, monospace",
      nameSizePx: 12,
      locationSizePx: 10,
      pinFormalSizePx: 11,
      commentSizePx: 12,
      regularWeight: 400,
      semiboldWeight: 600,
    })
  })
})

describe('LADDER_PALETTE', () => {
  it('has exactly the light, dark and paper palettes', () => {
    expect(Object.keys(LADDER_PALETTE).sort()).toEqual(['dark', 'light', 'paper'])
  })

  it('holds the light palette values', () => {
    expect(LADDER_PALETTE.light).toEqual({
      bg: '#ffffff',
      wire: '#5a6575',
      rail: '#7b8594',
      text: '#1c2229',
      muted: '#6a7482',
      loc: '#3f6fa8',
      literal: '#a86400',
      on: '#14a44d',
      brand: '#0464fb',
      blockHeader: '#e8ecf1',
      blockFill: '#fbfcfd',
      selectionBand: '#eaf1ff',
      menu: '#ffffff',
      menuLine: '#d6dbe2',
      separator: '#dfe3e8',
    })
  })

  it('holds the dark palette values', () => {
    expect(LADDER_PALETTE.dark).toEqual({
      bg: '#12161c',
      wire: '#7f8b9b',
      rail: '#8d98a7',
      text: '#e1e6ec',
      muted: '#929dab',
      loc: '#7fa8d8',
      literal: '#e0a64a',
      on: '#2fd16c',
      brand: '#3b82f6',
      blockHeader: '#2a3442',
      blockFill: '#171c23',
      selectionBand: '#16233b',
      menu: '#1d232b',
      menuLine: '#323a45',
      separator: '#272d36',
    })
  })

  it('holds the paper palette values', () => {
    expect(LADDER_PALETTE.paper).toEqual({
      bg: '#ffffff',
      wire: '#1a1a1a',
      rail: '#1a1a1a',
      text: '#000000',
      muted: '#4a4a4a',
      loc: '#3a3a3a',
      literal: '#6b4300',
      on: '#1a1a1a',
      brand: '#1a1a1a',
      blockHeader: '#e8e8e8',
      blockFill: '#ffffff',
      selectionBand: '#ffffff',
      menu: '#ffffff',
      menuLine: '#b8b8b8',
      separator: '#b8b8b8',
    })
  })
})
