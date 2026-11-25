import * as Tabs from '@radix-ui/react-tabs'
import { ChevronUp, X } from 'lucide-react'

import { cn } from '../../../utils/cn'
import type { BottomPanelTab, BottomPanelTabId } from './tabs'

/** Text tab of the open panel's header; the active one is underlined. */
export const BottomPanelTabTrigger = ({ tab }: { tab: BottomPanelTab }) => (
  <Tabs.Trigger
    value={tab.id}
    className='h-7 select-none border-b-2 border-transparent px-0.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500 transition-colors hover:text-neutral-850 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 data-[state=active]:border-blue-500 data-[state=active]:text-neutral-950 dark:text-neutral-500 dark:hover:text-neutral-200 dark:data-[state=active]:text-neutral-100'
  >
    {tab.label}
  </Tabs.Trigger>
)

/** Button that hides the open panel. */
export const BottomPanelHideButton = ({ onHide }: { onHide: () => void }) => (
  <button
    type='button'
    aria-label='Hide panel'
    title='Hide panel (Ctrl+J)'
    onClick={onHide}
    className='flex h-6 w-6 items-center justify-center rounded text-neutral-500 hover:bg-neutral-100 hover:text-neutral-850 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 dark:hover:bg-neutral-900 dark:hover:text-neutral-200'
  >
    <X className='h-4 w-4' strokeWidth={1.8} />
  </button>
)

type BottomPanelStripProps = {
  tabs: BottomPanelTab[]
  onOpenTab: (id: BottomPanelTabId) => void
  onReopen: () => void
}

/** Strip shown while the panel is hidden: one button per tab, and a chevron that reopens the last tab used. */
export const BottomPanelStrip = ({ tabs, onOpenTab, onReopen }: BottomPanelStripProps) => (
  <div
    role='toolbar'
    aria-label='Bottom panel'
    className='flex h-[26px] flex-none select-none items-center gap-0.5 rounded-md border border-neutral-200 bg-neutral-50 px-1.5 dark:border-neutral-800 dark:bg-neutral-950'
  >
    {tabs.map(({ id, label, Icon }) => (
      <button
        key={id}
        type='button'
        onClick={() => onOpenTab(id)}
        className='flex h-5 items-center gap-1.5 rounded px-2 text-[11px] font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-850 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 dark:hover:bg-neutral-900 dark:hover:text-neutral-200'
      >
        <Icon className='h-3.5 w-3.5' strokeWidth={1.8} aria-hidden />
        {label}
      </button>
    ))}
    <button
      type='button'
      aria-label='Show panel'
      title='Show panel (Ctrl+J)'
      onClick={onReopen}
      className={cn(
        'ml-auto flex h-5 w-6 items-center justify-center rounded text-neutral-500 hover:bg-neutral-100 hover:text-neutral-850',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 dark:hover:bg-neutral-900 dark:hover:text-neutral-200',
      )}
    >
      <ChevronUp className='h-4 w-4' strokeWidth={1.8} />
    </button>
  </div>
)
