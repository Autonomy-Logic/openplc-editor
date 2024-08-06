import * as PrimitiveTooltip from '@radix-ui/react-tooltip'
import { cn } from '@root/utils'
import { ComponentPropsWithoutRef, ElementRef, forwardRef } from 'react'

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
const TooltipContent = ({ children, className, ...rest }: TooltipContentProps) => {
  return (
    <PrimitiveTooltip.Portal>
      <PrimitiveTooltip.Content
        {...rest}
        className={cn(
          'h-fit max-h-56 w-fit max-w-96 overflow-y-auto rounded-md border border-neutral-850 bg-white p-4 shadow-md dark:bg-neutral-900 dark:text-white',
          className
        )}
      >
        {children}
        <PrimitiveTooltip.Arrow className='fill-white dark:fill-neutral-900' />
      </PrimitiveTooltip.Content>
    </PrimitiveTooltip.Portal>
  )
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
