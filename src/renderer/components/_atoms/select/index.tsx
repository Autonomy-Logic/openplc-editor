import * as PrimitiveSelect from '@radix-ui/react-select'
import { ArrowIcon } from '@root/renderer/assets'
import { ComponentPropsWithoutRef, ElementRef, forwardRef } from 'react'

const Select = PrimitiveSelect.Root

type ISelectTriggerProps = ComponentPropsWithoutRef<
	typeof PrimitiveSelect.Trigger
> & {
	placeholder?: string
}
const SelectTrigger = forwardRef<
	ElementRef<typeof PrimitiveSelect.Trigger>,
	ISelectTriggerProps
>(({ children, placeholder, className, ...rest }, forwardedRef) => {
	return (
		<PrimitiveSelect.Trigger className={className} {...rest} ref={forwardedRef}>
			<PrimitiveSelect.Value placeholder={placeholder} />
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
				<PrimitiveSelect.Viewport className='w-full h-full'>
					{children}
				</PrimitiveSelect.Viewport>
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

export { Select, SelectTrigger, SelectContent, SelectItem }