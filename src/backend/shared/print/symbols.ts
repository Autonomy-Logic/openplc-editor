/**
 * FBD symbol geometry and SVG path data, duplicated (not imported) from the on-screen icons: `backend/shared` cannot
 * depend on the `components` layer. Keep in sync with `frontend/components/_atoms/graphical-editor/fbd/svg/*.tsx`.
 * Ladder symbols come from the layout engine (`ladder-layout/symbols.ts`).
 */

export const INK_COLOR = '#030303'

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
