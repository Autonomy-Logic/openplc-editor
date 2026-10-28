import type { ReactNode } from 'react'

import { slotRowClassName } from './slot-list-helpers'

function SlotList({ children }: { children: ReactNode }) {
  return (
    <div className='flex w-56 shrink-0 flex-col overflow-y-auto rounded-md border border-neutral-200 dark:border-neutral-700'>
      {children}
    </div>
  )
}

type SlotSelectButtonProps = {
  slotNumber: number
  moduleName: string | undefined
  ioSummary?: string
  badge?: ReactNode
  subtitle?: string
  isSelected: boolean
  onSelect: () => void
}

function SlotSelectButton({
  slotNumber,
  moduleName,
  ioSummary,
  badge,
  subtitle,
  isSelected,
  onSelect,
}: SlotSelectButtonProps) {
  return (
    <button
      type='button'
      aria-selected={isSelected}
      onClick={onSelect}
      className='flex min-w-0 flex-1 flex-col gap-0.5 px-2 py-2 text-left'
    >
      <div className='flex items-center justify-between gap-2'>
        <span
          className={`font-caption text-cp-sm text-neutral-950 dark:text-white ${isSelected ? 'font-bold' : 'font-semibold'}`}
        >
          Slot {slotNumber}
        </span>
        {moduleName && ioSummary !== undefined && (
          <span className='shrink-0 text-[10px] text-neutral-400 dark:text-neutral-500'>{ioSummary}</span>
        )}
        {badge}
      </div>
      <span
        className={`truncate text-xs ${moduleName ? 'text-neutral-700 dark:text-neutral-300' : 'italic text-neutral-400 dark:text-neutral-600'} ${isSelected ? 'font-semibold' : ''}`}
      >
        {moduleName ?? 'Empty'}
      </span>
      {subtitle && <span className='truncate text-[11px] text-neutral-500 dark:text-neutral-400'>{subtitle}</span>}
    </button>
  )
}

/** Non-sortable slot row: same look as the sortable one, with the handle column left blank. */
function SlotListItem(props: SlotSelectButtonProps) {
  return (
    <div className={slotRowClassName(props.isSelected)}>
      <div className='w-6 shrink-0' aria-hidden />
      <SlotSelectButton {...props} />
    </div>
  )
}

export { SlotList, SlotListItem, SlotSelectButton }
export type { SlotSelectButtonProps }
