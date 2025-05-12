import * as PrimitiveSelect from '@radix-ui/react-select'
import { ArrowIcon } from '@root/renderer/assets'
import { cn } from '@root/utils'
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
          <ArrowIcon size='sm' className='rotate-270 stroke-brand transition-all group-data-[state=open]:rotate-90' />
        )}
      </PrimitiveSelect.Trigger>
    )
  },
)

type ISelectContentProps = ComponentPropsWithoutRef<typeof PrimitiveSelect.Content> & {
  'data-align'?: 'start' | 'end' | 'center'
  'data-side'?: 'left' | 'right' | 'bottom' | 'top'
  viewportRef?: React.Ref<HTMLDivElement>
}
const SelectContent = forwardRef<ElementRef<typeof PrimitiveSelect.Content>, ISelectContentProps>(
  (
    {
      children,
      sideOffset = 5,
      alignOffset = 5,
      position = 'popper',
      align = 'center',
      side = 'bottom',
      className,
      viewportRef,
      ...res
    },
    forwardedRef,
  ) => {
    return (
      <PrimitiveSelect.Portal>
        <PrimitiveSelect.Content
          ref={forwardedRef}
          className={className}
          sideOffset={sideOffset}
          alignOffset={alignOffset}
          position={position}
          align={align}
          side={side}
          {...res}
        >
          {/* <PrimitiveSelect.ScrollUpButton>
          <ArrowIcon direction='up' size='sm' className='stroke-brand' />
        </PrimitiveSelect.ScrollUpButton> */}
          <PrimitiveSelect.Viewport ref={viewportRef} className=' h-full w-full overflow-auto'>{children}</PrimitiveSelect.Viewport>
          {/* <PrimitiveSelect.ScrollDownButton>
          <ArrowIcon direction='down' size='sm' className='stroke-brand' />
        </PrimitiveSelect.ScrollDownButton> */}
        </PrimitiveSelect.Content>
      </PrimitiveSelect.Portal>
    )
  },
)

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

const SelectGroup = PrimitiveSelect.Group

const SelectSeparator = () => <PrimitiveSelect.Separator className='m-[5px] h-px bg-brand' />

type ISelectLabelProps = ComponentPropsWithoutRef<typeof PrimitiveSelect.Label>

const SelectLabel = forwardRef<ElementRef<typeof PrimitiveSelect.Label>, ISelectLabelProps>(
  ({ className, ...res }, forwardedRef) => {
    return (
      <PrimitiveSelect.Label
        className={cn('text-center font-caption text-xs font-medium text-neutral-700 dark:text-white', className)}
        {...res}
        ref={forwardedRef}
      >
        {res.children}
      </PrimitiveSelect.Label>
    )
  },
)
export { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger }
