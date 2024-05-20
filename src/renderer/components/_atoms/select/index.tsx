import * as PrimitiveSelect from '@radix-ui/react-select'
import { ArrowIcon } from '@root/renderer/assets'
import { ComponentPropsWithoutRef, ElementRef, forwardRef, ReactElement } from 'react'

const Select = PrimitiveSelect.Root

type ISelectTriggerProps = ComponentPropsWithoutRef<typeof PrimitiveSelect.Trigger> & {
  placeholder?: string
  withIndicator?: boolean
}
const SelectTrigger = forwardRef<ElementRef<typeof PrimitiveSelect.Trigger>, ISelectTriggerProps>(
  ({ placeholder, withIndicator = false, className, ...rest }, forwardedRef) => {
    return (
      <PrimitiveSelect.Trigger className={className} {...rest} ref={forwardedRef}>
        <PrimitiveSelect.Value placeholder={placeholder} />
        {withIndicator && (
          <ArrowIcon
            size='sm'
            className='rotate-270 stroke-brand-light transition-all group-data-[state=open]:rotate-90 group-data-[state=open]:stroke-brand'
          />
        )}
      </PrimitiveSelect.Trigger>
    )
  },
)

type ISelectContentProps = ComponentPropsWithoutRef<typeof PrimitiveSelect.Content>
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
        <PrimitiveSelect.Viewport className='h-full w-full'>{children}</PrimitiveSelect.Viewport>
        <PrimitiveSelect.ScrollDownButton>
          <ArrowIcon direction='down' size='sm' className='stroke-brand' />
        </PrimitiveSelect.ScrollDownButton>
      </PrimitiveSelect.Content>
    </PrimitiveSelect.Portal>
  )
}

type ISelectItemProps = ComponentPropsWithoutRef<typeof PrimitiveSelect.Item> & {
  indicator?: ReactElement
}

const SelectItem = forwardRef<ElementRef<typeof PrimitiveSelect.Item>, ISelectItemProps>(
  ({ children, indicator, ...res }, forwardedRef) => {
    return (
      <PrimitiveSelect.Item {...res} ref={forwardedRef}>
        <PrimitiveSelect.ItemText>{children}</PrimitiveSelect.ItemText>
        <PrimitiveSelect.ItemIndicator>
          {/** Icon for item indicator */}
          {indicator}
        </PrimitiveSelect.ItemIndicator>
      </PrimitiveSelect.Item>
    )
  },
)

export { Select, SelectContent, SelectItem, SelectTrigger }
