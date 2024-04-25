import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'
import { cn } from '@utils/cn'
import { ComponentPropsWithoutRef, ElementRef, forwardRef } from 'react'

const Viewport = forwardRef<
  ElementRef<typeof ScrollAreaPrimitive.ScrollAreaViewport>,
  ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaViewport>
>(({ className, children, ...props }, ref) => (
  <ScrollAreaPrimitive.Viewport ref={ref} className={cn('h-full w-full rounded-[inherit]', className)} {...props}>
    {children}
  </ScrollAreaPrimitive.Viewport>
))

Viewport.displayName = ScrollAreaPrimitive.Viewport.displayName

export { Viewport }
