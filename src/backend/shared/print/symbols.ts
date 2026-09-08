/**
 * Ladder/FBD symbol geometry and SVG path data, duplicated (not imported)
 * from the on-screen icons — `backend/shared` cannot depend on the
 * `components` layer. Keep these in sync with
 * `frontend/assets/icons/flow/{Coil,Contact}.tsx` and
 * `frontend/components/_atoms/graphical-editor/fbd/svg/*.tsx` by hand.
 */

export const INK_COLOR = '#030303'
export const BRAND_COLOR = '#0464FB'

// ---------------------------------------------------------------------------
// Ladder — coil / contact
// ---------------------------------------------------------------------------

export const COIL_BLOCK_WIDTH = 28
export const COIL_BLOCK_HEIGHT = 24
export const COIL_ICON_VIEWBOX = { width: 34, height: 28 }

export const CONTACT_BLOCK_WIDTH = 24
export const CONTACT_BLOCK_HEIGHT = 24
export const CONTACT_ICON_VIEWBOX = { width: 28, height: 28 }

/** The two coil "parentheses" paths, `)( ` glyph, from Coil.tsx (viewBox 0 0 34 28). */
export const COIL_PARENTHESES_PATHS = [
  'M27 0C27.5915 1.20462 28.0845 2.35047 28.5117 3.40818C28.9718 4.4659 29.3333 5.55299 29.6291 6.64008C29.9249 7.75656 30.1549 8.90241 30.2864 10.0777C30.4507 11.2823 30.5164 12.6044 30.5164 14.0147C30.5164 15.4544 30.4507 16.7765 30.2864 17.9517C30.1549 19.1563 29.9249 20.3022 29.6291 21.3893C29.3333 22.4764 28.9718 23.5635 28.5117 24.6212C28.0845 25.6789 27.5915 26.8248 27 28H29.5305C30.9108 25.8258 32.0282 23.5341 32.8169 21.1542C33.6056 18.8038 34 16.4239 34 14.0147C34 11.6348 33.6056 9.25498 32.8169 6.87513C32.0282 4.49528 30.9108 2.20357 29.5305 0H27Z',
  'M7 0C6.40845 1.20462 5.91549 2.35047 5.48826 3.40818C5.02817 4.4659 4.66667 5.55299 4.37089 6.64008C4.07512 7.75656 3.84507 8.90241 3.71361 10.0777C3.5493 11.2823 3.48357 12.6044 3.48357 14.0147C3.48357 15.4544 3.5493 16.7765 3.71361 17.9517C3.84507 19.1563 4.07512 20.3022 4.37089 21.3893C4.66667 22.4764 5.02817 23.5635 5.48826 24.6212C5.91549 25.6789 6.40845 26.8248 7 28H4.46948C3.0892 25.8258 1.97183 23.5341 1.1831 21.1542C0.394366 18.8038 0 16.4239 0 14.0147C0 11.6348 0.394366 9.25498 1.1831 6.87513C1.97183 4.49528 3.0892 2.20357 4.46948 0H7Z',
] as const

/** Resolved endpoints of Coil.tsx's negation `<line>` (originally CSS-matrix-transformed), in the 34x28 viewBox space. */
export const COIL_NEGATION_LINE = { x1: 10.2366, y1: 20.4967, x2: 24.3787, y2: 6.3545 }

/** Resolved endpoints of Contact.tsx's negation `<line>`, in the 28x28 viewBox space. */
export const CONTACT_NEGATION_LINE = { x1: 4.4274, y1: 22.9004, x2: 22.8122, y2: 4.5156 }

export type CoilVariant = 'default' | 'negated' | 'risingEdge' | 'fallingEdge' | 'set' | 'reset'
export type ContactVariant = 'default' | 'negated' | 'risingEdge' | 'fallingEdge'

/** Modifier glyph drawn near the lower-right of the symbol; `''` for `default`. */
export const COIL_VARIANT_GLYPHS: Record<CoilVariant, string> = {
  default: '',
  negated: '',
  set: 'S',
  reset: 'R',
  risingEdge: 'P',
  fallingEdge: 'N',
}

export const CONTACT_VARIANT_GLYPHS: Record<ContactVariant, string> = {
  default: '',
  negated: '',
  risingEdge: 'P',
  fallingEdge: 'N',
}

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

// ---------------------------------------------------------------------------
// FBD — connector / continuation
// ---------------------------------------------------------------------------

export const CONNECTION_ELEMENT_WIDTH = 112
export const CONNECTION_ELEMENT_HEIGHT = 32
export const CONNECTION_ICON_VIEWBOX = { width: 112, height: 32 }

export const CONNECTOR_PATH =
  'M109 4C109 1.79086 107.209 0 105 0H22.2111C21.4214 0 20.6494 0.233752 19.9923 0.671799L1.9923 12.6718C-0.382632 14.2551 -0.382631 17.7449 1.9923 19.3282L19.9923 31.3282C20.6494 31.7662 21.4214 32 22.2111 32H105C107.209 32 109 30.2091 109 28V4Z'

export const CONTINUATION_PATH =
  'M0 4C0 1.79086 1.79086 0 4 0H86.7889C87.5786 0 88.3506 0.233752 89.0077 0.671799L107.008 12.6718C109.383 14.2551 109.383 17.7449 107.008 19.3282L89.0077 31.3282C88.3506 31.7662 87.5786 32 86.7889 32H4C1.79086 32 0 30.2091 0 28V4Z'

export const CONNECTION_FILL_COLOR = '#FFFFFF'
export const CONNECTION_STROKE_COLOR = '#50545F'
