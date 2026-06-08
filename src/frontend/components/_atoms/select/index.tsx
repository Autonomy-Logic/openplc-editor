import * as PrimitiveSelect from '@radix-ui/react-select'
import { ComponentPropsWithoutRef, ElementRef, forwardRef, ReactElement } from 'react'

import { ArrowIcon } from '../../../assets/icons/interface/Arrow'
import { cn } from '../../../utils/cn'

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
  /**
   * Disable Radix Select's built-in typeahead.  Set this when the
   * dropdown renders its own search input — Radix's typeahead
   * otherwise jumps focus to the first SelectItem whose label
   * starts with the typed character, fighting the search field
   * for keystrokes.
   *
   * Implementation: a React `onKeyDownCapture` on the Content
   * element swallows printable-character keystrokes (both the
   * React event and the native event) so Radix's typeahead never
   * sees them.  Navigation keys (arrows, Enter, Escape, Tab,
   * Home/End, Page Up/Down) and modifier combos pass through so
   * keyboard navigation still works.  Character insertion into
   * the focused search input is a keydown default action and
   * runs regardless of propagation control, so the user's typing
   * still lands in the input.
   */
  disableTypeahead?: boolean
}

const TYPEAHEAD_PASSTHROUGH_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Enter',
  'Escape',
  'Tab',
  'Home',
  'End',
  'PageUp',
  'PageDown',
])

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
      disableTypeahead = false,
      onKeyDownCapture,
      ...res
    },
    forwardedRef,
  ) => {
    const handleKeyDownCapture: React.KeyboardEventHandler<HTMLDivElement> = (event) => {
      if (disableTypeahead) {
        const isSingleChar = event.key.length === 1
        const isModifierCombo = event.ctrlKey || event.metaKey || event.altKey
        const isPassthrough = TYPEAHEAD_PASSTHROUGH_KEYS.has(event.key)
        if (isSingleChar && !isModifierCombo && !isPassthrough) {
          event.stopPropagation()
          event.nativeEvent.stopImmediatePropagation()
        }
      }
      onKeyDownCapture?.(event)
    }
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
          onKeyDownCapture={handleKeyDownCapture}
          {...res}
        >
          <PrimitiveSelect.Viewport ref={viewportRef} className='oplc-select-viewport h-full w-full'>
            {children}
          </PrimitiveSelect.Viewport>
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
        <PrimitiveSelect.ItemIndicator>{indicator}</PrimitiveSelect.ItemIndicator>
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
