import * as PrimitivePopover from '@radix-ui/react-popover'
import { ComponentPropsWithoutRef, ElementRef, forwardRef } from 'react'

const Popover = PrimitivePopover.Root

const PopoverTrigger = PrimitivePopover.Trigger

const PopoverContent = forwardRef<
	ElementRef<typeof PrimitivePopover.Content>,
	ComponentPropsWithoutRef<typeof PrimitivePopover.Content>
>(({ className, align = 'center', sideOffset = 4, ...rest }, ref) => (
	<PrimitivePopover.Portal>
		<PrimitivePopover.Content
			ref={ref}
			align={align}
			sideOffset={sideOffset}
			className={className}
			{...rest}
		/>
	</PrimitivePopover.Portal>
))

const PopoverClose = PrimitivePopover.Close

PopoverContent.displayName = PrimitivePopover.Content.displayName

export { Popover, PopoverTrigger, PopoverContent, PopoverClose }
