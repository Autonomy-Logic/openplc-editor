import { LADDER_STYLE, LADDER_TYPOGRAPHY } from './style'

export type CoilVariant = 'default' | 'negated' | 'risingEdge' | 'fallingEdge' | 'set' | 'reset'
export type ContactVariant = 'default' | 'negated' | 'risingEdge' | 'fallingEdge'

/** Modifier letter of each coil variant; `''` for the variants drawn without one. */
export const COIL_VARIANT_GLYPHS: Record<CoilVariant, string> = {
  default: '',
  negated: '',
  set: 'S',
  reset: 'R',
  risingEdge: 'P',
  fallingEdge: 'N',
}

/** Modifier letter of each contact variant; `''` for the variants drawn without one. */
export const CONTACT_VARIANT_GLYPHS: Record<ContactVariant, string> = {
  default: '',
  negated: '',
  risingEdge: 'P',
  fallingEdge: 'N',
}

/** Narrows a coil node's `variant` field; an absent or unknown value is `default`. */
export function asCoilVariant(value: string | undefined): CoilVariant {
  switch (value) {
    case 'negated':
    case 'risingEdge':
    case 'fallingEdge':
    case 'set':
    case 'reset':
      return value
    default:
      return 'default'
  }
}

/** Narrows a contact node's `variant` field; an absent or unknown value is `default`. */
export function asContactVariant(value: string | undefined): ContactVariant {
  switch (value) {
    case 'negated':
    case 'risingEdge':
    case 'fallingEdge':
      return value
    default:
      return 'default'
  }
}

export type LadderSymbolKind =
  | 'contact'
  | 'contact-negated'
  | 'contact-rising'
  | 'contact-falling'
  | 'coil'
  | 'coil-negated'
  | 'coil-set'
  | 'coil-reset'
  | 'coil-rising'
  | 'coil-falling'

export interface SymbolLine {
  x1: number
  y1: number
  x2: number
  y2: number
}

/** Stroke geometry of a contact or coil in its local box, origin top-left; `glyphText` is the S/R/P/N letter, centred. */
export interface SymbolGeometry {
  width: typeof LADDER_STYLE.sym
  height: typeof LADDER_STYLE.symH
  paths: readonly string[]
  lines: readonly SymbolLine[]
  glyphText?: { text: string; sizePx: number }
}

const WIDTH = LADDER_STYLE.sym
const HEIGHT = LADDER_STYLE.symH
const CENTER_X = WIDTH / 2
const CENTER_Y = HEIGHT / 2
const CONTACT_HALF = 5
const CONTACT_BRACKET = 3
const COIL_HALF = 7
const COIL_ARC_INSET = 4
const COIL_ARC_BULGE = 2
const CONTACT_LETTER_SIZE_PX = LADDER_TYPOGRAPHY.nameSizePx - 3
const COIL_LETTER_SIZE_PX = LADDER_TYPOGRAPHY.nameSizePx - 2

const CONTACT_PATHS: readonly string[] = [
  `M${CENTER_X - CONTACT_HALF - CONTACT_BRACKET} 0 H${CENTER_X - CONTACT_HALF} V${HEIGHT} H${CENTER_X - CONTACT_HALF - CONTACT_BRACKET}`,
  `M${CENTER_X + CONTACT_HALF + CONTACT_BRACKET} 0 H${CENTER_X + CONTACT_HALF} V${HEIGHT} H${CENTER_X + CONTACT_HALF + CONTACT_BRACKET}`,
]

const COIL_PATHS: readonly string[] = [
  `M${CENTER_X - COIL_HALF + COIL_ARC_INSET} 0 Q${CENTER_X - COIL_HALF - COIL_ARC_BULGE} ${CENTER_Y} ${CENTER_X - COIL_HALF + COIL_ARC_INSET} ${HEIGHT}`,
  `M${CENTER_X + COIL_HALF - COIL_ARC_INSET} 0 Q${CENTER_X + COIL_HALF + COIL_ARC_BULGE} ${CENTER_Y} ${CENTER_X + COIL_HALF - COIL_ARC_INSET} ${HEIGHT}`,
]

const NEGATION_LINE: SymbolLine = { x1: CENTER_X - 3, y1: HEIGHT - 1, x2: CENTER_X + 3, y2: 1 }

/** The geometry of a symbol with the given strokes and optional letter. */
function geometry(
  paths: readonly string[],
  lines: readonly SymbolLine[],
  letter: string,
  letterSizePx: number,
): SymbolGeometry {
  const base = { width: WIDTH, height: HEIGHT, paths, lines }
  return letter ? { ...base, glyphText: { text: letter, sizePx: letterSizePx } } : base
}

/** The geometry of a contact variant: two brackets, a diagonal when negated, and its P/N letter. */
function contactGeometry(variant: ContactVariant): SymbolGeometry {
  const lines = variant === 'negated' ? [NEGATION_LINE] : []
  return geometry(CONTACT_PATHS, lines, CONTACT_VARIANT_GLYPHS[variant], CONTACT_LETTER_SIZE_PX)
}

/** The geometry of a coil variant: two arcs, a diagonal when negated, and its S/R/P/N letter. */
function coilGeometry(variant: CoilVariant): SymbolGeometry {
  const lines = variant === 'negated' ? [NEGATION_LINE] : []
  return geometry(COIL_PATHS, lines, COIL_VARIANT_GLYPHS[variant], COIL_LETTER_SIZE_PX)
}

const SYMBOLS: Readonly<Record<LadderSymbolKind, SymbolGeometry>> = {
  contact: contactGeometry('default'),
  'contact-negated': contactGeometry('negated'),
  'contact-rising': contactGeometry('risingEdge'),
  'contact-falling': contactGeometry('fallingEdge'),
  coil: coilGeometry('default'),
  'coil-negated': coilGeometry('negated'),
  'coil-set': coilGeometry('set'),
  'coil-reset': coilGeometry('reset'),
  'coil-rising': coilGeometry('risingEdge'),
  'coil-falling': coilGeometry('fallingEdge'),
}

/** The 22 x 14 geometry of a contact (two brackets) or coil (two arcs) symbol. */
export function ladderSymbol(kind: LadderSymbolKind): SymbolGeometry {
  return SYMBOLS[kind]
}

const CONTACT_KINDS: Record<ContactVariant, LadderSymbolKind> = {
  default: 'contact',
  negated: 'contact-negated',
  risingEdge: 'contact-rising',
  fallingEdge: 'contact-falling',
}

const COIL_KINDS: Record<CoilVariant, LadderSymbolKind> = {
  default: 'coil',
  negated: 'coil-negated',
  set: 'coil-set',
  reset: 'coil-reset',
  risingEdge: 'coil-rising',
  fallingEdge: 'coil-falling',
}

/** The symbol kind of a ladder node from its type and `variant` field; undefined for a node that is not a contact or coil. */
export function symbolKindOf(nodeType: string, variant: string | undefined): LadderSymbolKind | undefined {
  if (nodeType === 'contact') return CONTACT_KINDS[asContactVariant(variant)]
  if (nodeType === 'coil') return COIL_KINDS[asCoilVariant(variant)]
  return undefined
}
