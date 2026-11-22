/** Font family, sizes in px and weights of every text the ladder editor draws. */
export const LADDER_TYPOGRAPHY = {
  family: "'JetBrains Mono', ui-monospace, Menlo, monospace",
  nameSizePx: 12,
  locationSizePx: 10,
  pinFormalSizePx: 11,
  commentSizePx: 12,
  regularWeight: 400,
  semiboldWeight: 600,
} as const

/** Spacing of the ladder layout in px: symbol box, gaps, block parts, gutters and paddings. */
export const LADDER_STYLE = {
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
} as const

export type LadderPaletteName = 'light' | 'dark' | 'paper'

/** Colours of one ladder theme, as `#rrggbb`. */
export interface LadderPalette {
  bg: string
  wire: string
  rail: string
  text: string
  muted: string
  loc: string
  literal: string
  on: string
  brand: string
  blockHeader: string
  blockFill: string
  selectionBand: string
  menu: string
  menuLine: string
  separator: string
}

/** The light and dark screen themes and the paper theme of print. */
export const LADDER_PALETTE: Readonly<Record<LadderPaletteName, LadderPalette>> = {
  light: {
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
  },
  dark: {
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
  },
  paper: {
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
  },
}
