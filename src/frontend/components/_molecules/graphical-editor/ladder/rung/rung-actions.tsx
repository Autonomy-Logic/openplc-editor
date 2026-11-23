import { type MouseEvent } from 'react'

import { cn } from '../../../../../utils/cn'

/** One action of the rung toolbar. */
export type RungAction = {
  label: string
  icon: keyof typeof RUNG_ACTION_ICONS
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
  disabled?: boolean
  danger?: boolean
}

type RungActionsProps = {
  actions: readonly RungAction[]
  /** Kept visible, as while the rung menu is open; otherwise it shows while the pointer is over the rung. */
  pinned?: boolean
  /** X of the toolbar's right edge, in px from the rung's left: just inside the right rail. */
  right: number
  top: number
}

const ICON = { width: 14, height: 14, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 } as const

/** The rung toolbar's icons: comment, duplicate, collapse, expand and delete. */
const RUNG_ACTION_ICONS = {
  comment: (
    <svg viewBox='0 0 16 16' {...ICON}>
      <path d='M3 4h10v6H7l-3 2.5V10H3z' />
    </svg>
  ),
  duplicate: (
    <svg viewBox='0 0 16 16' {...ICON}>
      <rect x='5' y='5' width='8' height='8' rx='1.5' />
      <path d='M3 10V4.5A1.5 1.5 0 0 1 4.5 3H10' />
    </svg>
  ),
  collapse: (
    <svg viewBox='0 0 16 16' {...ICON}>
      <path d='M4 10l4-4 4 4' />
    </svg>
  ),
  expand: (
    <svg viewBox='0 0 16 16' {...ICON}>
      <path d='M4 6l4 4 4-4' />
    </svg>
  ),
  delete: (
    <svg viewBox='0 0 16 16' {...ICON}>
      <path d='M3 4.5h10M6.5 4.5V3h3v1.5M5 4.5l.6 8.5h4.8l.6-8.5' />
    </svg>
  ),
} as const

/** The rung toolbar on the comment line, at the rung's right end: shown on hover of the rung (`group`). */
export const RungActions = ({ actions, pinned = false, right, top }: RungActionsProps) => (
  <div
    role='toolbar'
    aria-label='Rung actions'
    className={cn(
      'absolute z-10 flex gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100',
      pinned && 'opacity-100',
    )}
    style={{ top, left: right, transform: 'translateX(-100%)' }}
  >
    {actions.map((action) => (
      <button
        key={action.label}
        type='button'
        aria-label={action.label}
        title={action.label}
        disabled={action.disabled}
        onClick={(event) => {
          event.stopPropagation()
          action.onClick(event)
        }}
        className={cn(
          'flex h-[20px] w-[22px] items-center justify-center rounded border border-neutral-200 bg-white text-neutral-500',
          'hover:border-neutral-400 hover:text-neutral-850 disabled:cursor-not-allowed disabled:opacity-40',
          'dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400 dark:hover:border-neutral-600 dark:hover:text-neutral-100',
          action.danger && 'hover:border-red-500 hover:text-red-600 dark:hover:border-red-400 dark:hover:text-red-400',
        )}
      >
        {RUNG_ACTION_ICONS[action.icon]}
      </button>
    ))}
  </div>
)
