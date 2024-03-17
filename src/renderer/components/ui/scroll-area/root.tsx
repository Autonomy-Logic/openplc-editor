import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'
import { ComponentPropsWithoutRef, ElementRef, forwardRef } from 'react'

import { cn } from '@utils/cn'

const Root = forwardRef<
	ElementRef<typeof ScrollAreaPrimitive.Root>,
	ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root>
>(({ className, children, ...props }, ref) => (
	<ScrollAreaPrimitive.Root
		ref={ref}
		className={cn('relative overflow-hidden', className)}
		{...props}
	>
		{children}
		<ScrollAreaPrimitive.Corner />
	</ScrollAreaPrimitive.Root>
))

Root.displayName = ScrollAreaPrimitive.Root.displayName

// eslint-disable-next-line import/prefer-default-export
export { Root }
