import * as PrimitiveSelect from '@radix-ui/react-select'
import { ArrowIcon } from '@root/renderer/assets'
import { ComponentPropsWithoutRef, ElementRef, forwardRef } from 'react'

const Select = PrimitiveSelect.Root

const SelectValue = forwardRef<
	ElementRef<typeof PrimitiveSelect.Value>,
	ComponentPropsWithoutRef<typeof PrimitiveSelect.Value>
>(({ ...props }, forwardedRef) => {
	return <PrimitiveSelect.Value ref={forwardedRef} {...props} />
})

const SelectTrigger = forwardRef<
	ElementRef<typeof PrimitiveSelect.Trigger>,
	ComponentPropsWithoutRef<typeof PrimitiveSelect.Trigger>
>(({ children, className, ...rest }, forwardedRef) => {
	return (
		<PrimitiveSelect.Trigger className={className} ref={forwardedRef} {...rest}>
			{children}
			<PrimitiveSelect.Icon>
				<ArrowIcon size='sm' className='stroke-brand rotate-270 ' />
			</PrimitiveSelect.Icon>
		</PrimitiveSelect.Trigger>
	)
})

type ISelectContentProps = ComponentPropsWithoutRef<
	typeof PrimitiveSelect.Content
>
const SelectContent = ({
	children,
	sideOffset = 5,
	alignOffset = 5,
	position = 'popper',
	align = 'center',
	side = 'bottom',
	className,
	...res
}: ISelectContentProps) => {
	return (
		<PrimitiveSelect.Portal>
			<PrimitiveSelect.Content
				className={className}
				sideOffset={sideOffset}
				alignOffset={alignOffset}
				position={position}
				align={align}
				side={side}
				{...res}
			>
				<PrimitiveSelect.ScrollUpButton>
					<ArrowIcon direction='up' size='sm' className='stroke-brand' />
				</PrimitiveSelect.ScrollUpButton>
				<PrimitiveSelect.Viewport>{children}</PrimitiveSelect.Viewport>
				<PrimitiveSelect.ScrollDownButton>
					<ArrowIcon direction='down' size='sm' className='stroke-brand' />
				</PrimitiveSelect.ScrollDownButton>
			</PrimitiveSelect.Content>
		</PrimitiveSelect.Portal>
	)
}

type ISelectItemProps = ComponentPropsWithoutRef<
	typeof PrimitiveSelect.Item
> & {
	indicator?: JSX.Element
}

const SelectItem = forwardRef<
	ElementRef<typeof PrimitiveSelect.Item>,
	ISelectItemProps
>(({ children, indicator, ...res }, forwardedRef) => {
	return (
		<PrimitiveSelect.Item {...res} ref={forwardedRef}>
			<PrimitiveSelect.ItemText>{children}</PrimitiveSelect.ItemText>
			<PrimitiveSelect.ItemIndicator>
				{/** Icon for item indicator */}
				{indicator}
			</PrimitiveSelect.ItemIndicator>
		</PrimitiveSelect.Item>
	)
})

export { Select, SelectValue, SelectTrigger, SelectContent, SelectItem }
