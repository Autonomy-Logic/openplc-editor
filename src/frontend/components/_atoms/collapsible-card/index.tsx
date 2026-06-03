import * as AccordionPrimitive from '@radix-ui/react-accordion'
import { ChevronDownIcon } from '@radix-ui/react-icons'
import type { ReactNode } from 'react'

import { cn } from '../../../utils/cn'

/**
 * Expandable "card" matching the S7Comm / server-editor accordion look:
 * a bordered card with a clickable header, a chevron that rotates on
 * open, and a slide animation on the body.
 *
 * Each card is its own single-item `Accordion.Root` so multiple cards
 * on the same screen open/close independently. The same visual is used
 * (inlined) across the server editors; this atom centralises it so new
 * call sites — like the VPP `form` screen sections — stay in sync.
 */

// The single fixed item value — each card owns exactly one item, so the
// concrete string is irrelevant as long as it matches `defaultValue`.
const ITEM_VALUE = 'item'

type CollapsibleCardProps = {
  title: ReactNode
  /** Whether the card starts expanded. Defaults to open. */
  defaultOpen?: boolean
  /** When false, the card has no toggle/chevron and stays expanded. */
  collapsible?: boolean
  className?: string
  children: ReactNode
}

const CARD_CLASS = 'overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-700'
const HEADER_BASE =
  'flex w-full items-center justify-between bg-neutral-50 px-3 py-2 text-left text-sm font-medium dark:bg-neutral-800'
const TITLE_CLASS = 'text-neutral-950 dark:text-white'
const BODY_CLASS = 'border-t border-neutral-200 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900'

function CollapsibleCard({ title, defaultOpen = true, collapsible = true, className, children }: CollapsibleCardProps) {
  // Static (non-collapsible) card: same chrome, no trigger / chevron,
  // body always visible.
  if (!collapsible) {
    return (
      <div className={cn(CARD_CLASS, className)}>
        <div className={HEADER_BASE}>
          <span className={TITLE_CLASS}>{title}</span>
        </div>
        <div className={BODY_CLASS}>{children}</div>
      </div>
    )
  }

  return (
    <AccordionPrimitive.Root type='single' collapsible defaultValue={defaultOpen ? ITEM_VALUE : undefined}>
      <AccordionPrimitive.Item value={ITEM_VALUE} className={cn(CARD_CLASS, className)}>
        <AccordionPrimitive.Header className='flex'>
          <AccordionPrimitive.Trigger
            className={cn('group transition-all hover:bg-neutral-100 dark:hover:bg-neutral-700', HEADER_BASE)}
          >
            <span className={TITLE_CLASS}>{title}</span>
            <ChevronDownIcon
              className='h-4 w-4 text-neutral-500 transition-transform duration-200 ease-in-out group-data-[state=open]:rotate-180 dark:text-neutral-400'
              aria-hidden
            />
          </AccordionPrimitive.Trigger>
        </AccordionPrimitive.Header>
        <AccordionPrimitive.Content
          className={cn(
            'overflow-hidden transition-all duration-200 ease-in-out data-[state=closed]:animate-slideUp data-[state=open]:animate-slideDown',
          )}
        >
          <div className={BODY_CLASS}>{children}</div>
        </AccordionPrimitive.Content>
      </AccordionPrimitive.Item>
    </AccordionPrimitive.Root>
  )
}

export { CollapsibleCard }
