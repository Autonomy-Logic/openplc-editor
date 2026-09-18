import * as PrimitiveTooltip from '@radix-ui/react-tooltip'
import { ComponentPropsWithoutRef, ElementRef, forwardRef } from 'react'

import { cn } from '../../../utils/cn'

const TooltipProvider = PrimitiveTooltip.Provider
const Tooltip = PrimitiveTooltip.Root

type TooltipTriggerProps = ComponentPropsWithoutRef<typeof PrimitiveTooltip.Trigger>
const TooltipTrigger = forwardRef<ElementRef<typeof PrimitiveTooltip.Trigger>, TooltipTriggerProps>(
  ({ children, ...rest }, forwardedRef) => {
    return (
      <PrimitiveTooltip.Trigger ref={forwardedRef} {...rest}>
        {children}
      </PrimitiveTooltip.Trigger>
    )
  },
)

type TooltipContentProps = ComponentPropsWithoutRef<typeof PrimitiveTooltip.Content>
const TooltipContent = ({ children, className, arrow = true, ...rest }: TooltipContentProps & { arrow?: boolean }) => {
  return (
    <PrimitiveTooltip.Portal>
      <PrimitiveTooltip.Content
        {...rest}
        className={cn(
          'z-[999] h-fit max-h-56 w-fit max-w-96 overflow-y-auto rounded-md border border-neutral-850 bg-white p-4 shadow-md dark:bg-neutral-900 dark:text-white',
          'group',
          className,
        )}
      >
        <div>
          {children}
          {arrow && (
            <PrimitiveTooltip.Arrow className='fill-neutral-850 group-data-[side=bottom]:mt-1 group-data-[side=left]:ml-1 group-data-[side=right]:mr-1 group-data-[side=top]:mb-1' />
          )}
        </div>
      </PrimitiveTooltip.Content>
    </PrimitiveTooltip.Portal>
  )
}

const SidebarTooltipContent = ({
  children,
  className,
  arrow = true,
  ...rest
}: TooltipContentProps & { arrow?: boolean }) => {
  return (
    <PrimitiveTooltip.Portal>
      <PrimitiveTooltip.Content
        {...rest}
        className={cn(
          'box z-[999] h-fit max-h-56 w-fit min-w-20 max-w-96 overflow-y-auto rounded-md border bg-white p-2 dark:bg-neutral-900 dark:text-white',
          'group',
          className,
        )}
      >
        <div>
          {children}
          {arrow && (
            <PrimitiveTooltip.Arrow className='fill-neutral-850 group-data-[side=bottom]:mt-1 group-data-[side=left]:ml-1 group-data-[side=right]:mr-1 group-data-[side=top]:mb-1' />
          )}
        </div>
      </PrimitiveTooltip.Content>
    </PrimitiveTooltip.Portal>
  )
}

/**
 * The "what is this field" glyph, revealing its help text on hover or focus.
 *
 * Field help lives behind this rather than beside the control on purpose: a
 * sentence printed next to every row turns a settings screen into a wall of
 * prose, and the rows stop lining up. It is one component so the native
 * screens and the VPP-declared ones behave identically -- the user should not
 * be able to tell which kind of screen they are on.
 *
 * Needs a `TooltipProvider` above it.
 */
const FieldHelpIcon = ({ text }: { text: string }) => (
  <Tooltip delayDuration={150}>
    <TooltipTrigger asChild>
      <span
        tabIndex={0}
        aria-label='Field help'
        className='inline-flex h-3.5 w-3.5 shrink-0 cursor-help select-none items-center justify-center rounded-full text-neutral-400 hover:text-neutral-600 focus:outline-none focus-visible:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300'
      >
        <svg viewBox='0 0 16 16' fill='none' className='h-3.5 w-3.5'>
          <circle cx='8' cy='8' r='7' stroke='currentColor' strokeWidth='1.5' />
          <path d='M8 7.25v4.25' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' />
          <circle cx='8' cy='4.75' r='0.85' fill='currentColor' />
        </svg>
      </span>
    </TooltipTrigger>
    <TooltipContent side='right' align='start' sideOffset={6} className='text-xs'>
      {text}
    </TooltipContent>
  </Tooltip>
)

export { FieldHelpIcon, SidebarTooltipContent, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
