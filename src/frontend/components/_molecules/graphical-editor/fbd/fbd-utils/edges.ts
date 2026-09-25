import { SQUARE_FBD_THEMES, type ThemeVariant } from '../../../../../../middleware/shared/ports/theme-port'

export type FbdEdgeType = 'smoothstep' | 'step'

export function getFbdEdgeType(theme: ThemeVariant): FbdEdgeType {
  return SQUARE_FBD_THEMES.has(theme) ? 'step' : 'smoothstep'
}

export function applyFbdEdgeTheme<T extends { type?: string }>(edges: T[], theme: ThemeVariant): T[] {
  if (!SQUARE_FBD_THEMES.has(theme)) return edges
  return edges.map((edge) => (edge.type === 'step' ? edge : { ...edge, type: 'step' }))
}
