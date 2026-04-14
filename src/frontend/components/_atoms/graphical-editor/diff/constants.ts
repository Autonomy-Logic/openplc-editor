import type { DiffStatus } from '../../../../../middleware/shared/ports/version-control-port'

export const STRUCTURAL_NODE_TYPES = new Set([
  'powerRail',
  'parallel',
  'placeholder',
  'parallelPlaceholder',
  'mockNode',
  'variable',
])

export const DIFF_RING: Record<DiffStatus, string> = {
  added: 'ring-2 ring-green-500',
  removed: 'ring-2 ring-red-500',
  modified: 'ring-2 ring-yellow-500',
  unchanged: '',
}

export const DIFF_BG: Record<DiffStatus, string> = {
  added: 'bg-green-500/10',
  removed: 'bg-red-500/10',
  modified: 'bg-yellow-500/10',
  unchanged: '',
}

export const EDGE_DIFF_STROKE: Record<DiffStatus, string> = {
  added: '#22c55e',
  removed: '#ef4444',
  modified: '#eab308',
  unchanged: '',
}

export const VAR_DIFF_COLORS: Record<DiffStatus, string> = {
  added: 'bg-green-500/15 text-green-700 dark:text-green-400',
  removed: 'bg-red-500/15 text-red-700 dark:text-red-400 line-through',
  modified: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400',
  unchanged: '',
}
