import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import {
  ComponentPropsWithoutRef,
  ElementRef,
  ForwardedRef,
  forwardRef,
  HTMLAttributes,
} from 'react';

import { cn } from '@/utils';

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
      className
    )}
    {...props}
  >
    <ScrollAreaPrimitive.ScrollAreaThumb className='relative flex-1 rounded-full bg-brand' />
  </ScrollAreaPrimitive.ScrollAreaScrollbar>
));

ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName;

type CustomDisplayProps = HTMLAttributes<HTMLDivElement>;

const CustomDisplay = forwardRef(
  ({ className, children, ...props }: CustomDisplayProps, ref: ForwardedRef<HTMLDivElement>) => (
    <div
      ref={ref}
      className={cn('h-full w-full rounded-[inherit] grid grid-cols-4 gap-6 pr-5', className)}
      {...props}
    >
      {children}
    </div>
  )
);

CustomDisplay.displayName = 'CustomDisplay';

const ScrollArea = forwardRef<
  ElementRef<typeof ScrollAreaPrimitive.Root>,
  ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root>
>(({ className, children, ...props }, ref) => (
  <ScrollAreaPrimitive.Root
    ref={ref}
    className={cn('relative overflow-hidden', className)}
    {...props}
  >
    <ScrollAreaPrimitive.Viewport className='h-full w-full rounded-[inherit]'>
      <CustomDisplay>{children}</CustomDisplay>
    </ScrollAreaPrimitive.Viewport>
    <ScrollBar />
    <ScrollAreaPrimitive.Corner />
  </ScrollAreaPrimitive.Root>
));

ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName;

export { ScrollArea, ScrollBar };
