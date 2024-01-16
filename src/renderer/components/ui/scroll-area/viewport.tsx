import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import { ComponentPropsWithoutRef, ElementRef, forwardRef } from 'react';

import { cn } from '~/utils';

const Viewport = forwardRef<
  ElementRef<typeof ScrollAreaPrimitive.ScrollAreaViewport>,
  ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaViewport>
>(({ className, children, ...props }, ref) => (
  <ScrollAreaPrimitive.Viewport
    ref={ref}
    className={cn('h-full w-full rounded-[inherit]', className)}
    {...props}
  >
    {children}
  </ScrollAreaPrimitive.Viewport>
));

Viewport.displayName = ScrollAreaPrimitive.Viewport.displayName;

// eslint-disable-next-line import/prefer-default-export
export { Viewport };
