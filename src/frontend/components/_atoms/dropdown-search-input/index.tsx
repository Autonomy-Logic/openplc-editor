import { ComponentPropsWithoutRef, forwardRef } from 'react'

import { cn } from '../../../utils/cn'
import { InputWithRef } from '../input'

/**
 * Rounded text field rendered inside a sticky header strip — the
 * search-affordance used at the top of every filtered dropdown in
 * the editor (variable-type pickers, device-board dropdown, etc.).
 *
 * The wrapper is `sticky top-0` so the field stays pinned while the
 * dropdown's content scrolls.  Padded so the field doesn't touch
 * the dropdown's rounded border (which used to surface as a visual
 * notch in the corner).
 *
 * `onKeyDown` defaults to `e.stopPropagation()` so the parent
 * dropdown (Radix DropdownMenu / Select) doesn't intercept the
 * keystroke for its own typeahead.  Callers can pass their own
 * handler; we call it after stopping propagation.  Space gets
 * `preventDefault` to keep parents like Radix Select from toggling
 * closed on a literal space.
 */
type DropdownSearchInputProps = Omit<ComponentPropsWithoutRef<typeof InputWithRef>, 'type'> & {
  /** Optional extra classes for the outer sticky wrapper.  The input
   *  itself takes shape from the component; layout context lives on
   *  this wrapper. */
  containerClassName?: string
}

export const DropdownSearchInput = forwardRef<HTMLInputElement, DropdownSearchInputProps>(
  ({ containerClassName, className, onKeyDown, placeholder = 'Search...', ...rest }, ref) => {
    return (
      <div className={cn('sticky top-0 z-10 bg-white p-2 dark:bg-neutral-950', containerClassName)}>
        <InputWithRef
          ref={ref}
          type='text'
          placeholder={placeholder}
          className={cn(
            'w-full rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-700 outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-500',
            className,
          )}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === ' ') event.preventDefault()
            onKeyDown?.(event)
          }}
          {...rest}
        />
      </div>
    )
  },
)

DropdownSearchInput.displayName = 'DropdownSearchInput'
