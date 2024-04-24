import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'
import { cn } from '@utils/cn'
import { ComponentPropsWithoutRef, ElementRef, forwardRef } from 'react'

const ScrollBar = forwardRef<
  ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
>(({ className, orientation = 'vertical', ...props }, ref) => (
  <ScrollAreaPrimitive.ScrollAreaScrollbar
    ref={ref}
    orientation={orientation}
    className={cn(
      'flex touch-none select-none transition-colors',
      orientation === 'vertical' && 'h-full w-1 border-l-transparent p-[1px]',
      orientation === 'horizontal' && 'h-2.5 flex-col border-t-transparent p-[1px]',
      className,
    )}
    {...props}
  >
    <ScrollAreaPrimitive.ScrollAreaThumb className='relative flex-1 rounded-[10px] bg-brand' />
  </ScrollAreaPrimitive.ScrollAreaScrollbar>
))

ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName

export { ScrollBar }
