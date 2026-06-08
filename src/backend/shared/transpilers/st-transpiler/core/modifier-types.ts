/**
 * Contact / coil modifier shapes.  Shared by the walker (which derives
 * them from React Flow `data.variant` via `narrow.ts`) and by
 * `extractModifier` (which translates them into ST emission steps).
 */

export interface ContactModifier {
  negated?: boolean
  edge?: 'rising' | 'falling'
}

export interface CoilModifier {
  negated?: boolean
  storage?: 'set' | 'reset'
  edge?: 'rising' | 'falling'
}
