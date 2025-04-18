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

export { SidebarTooltipContent, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
