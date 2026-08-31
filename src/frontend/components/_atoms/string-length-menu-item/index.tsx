import * as PrimitiveDropdown from '@radix-ui/react-dropdown-menu'

import { cn } from '../../../utils/cn'
import { MAX_STRING_LENGTH, parseStringLength } from '../../../utils/iec-types-registry'
import { InputWithRef } from '../input'

type IStringLengthMenuItemProps = {
  /** Canonical, upper-cased: STRING or WSTRING. */
  typeName: string
  /** Current contents of the length box, as typed. */
  length: string
  onLengthChange: (next: string) => void
  /** Called with `STRING` or `STRING(23)` once the row is applied. */
  onApply: (declaredType: string) => void
  /** Class for the label, so each menu keeps its own type scale. */
  labelClassName?: string
}

/**
 * A STRING or WSTRING row in a type menu, with its declared length beside it.
 * An empty box selects the unqualified type.
 */
export const StringLengthMenuItem = ({
  typeName,
  length,
  onLengthChange,
  onApply,
  labelClassName = 'font-caption text-xs font-normal text-neutral-700 dark:text-neutral-500',
}: IStringLengthMenuItemProps) => {
  const trimmed = length.trim()
  const declaredType = trimmed === '' ? typeName : `${typeName}(${trimmed})`
  const valid = trimmed === '' || parseStringLength(declaredType).valid

  return (
    <PrimitiveDropdown.Item
      onSelect={(event) => {
        // Refuse rather than silently apply the unqualified type.
        if (!valid) {
          event.preventDefault()
          return
        }
        onApply(declaredType)
      }}
      className='flex h-8 w-full cursor-pointer items-center justify-center gap-1 py-1 outline-none hover:bg-neutral-100 dark:hover:bg-neutral-900'
    >
      <span className={labelClassName}>{typeName}</span>
      <InputWithRef
        type='text'
        inputMode='numeric'
        aria-label={`${typeName} length`}
        title={`Declared length, 1 to ${MAX_STRING_LENGTH}. Leave empty for plain ${typeName}.`}
        placeholder='( )'
        className={cn(
          'w-12 rounded-md border bg-transparent px-1 py-0.5 text-center font-caption text-xs outline-none',
          valid
            ? 'border-neutral-200 text-neutral-700 dark:border-neutral-800 dark:text-neutral-500'
            : 'border-red-500 text-red-500 dark:border-red-500',
        )}
        value={length}
        onChange={(e) => onLengthChange(e.target.value)}
        // Radix routes typing to its typeahead and Space/Enter to selection, so
        // digits reach the box only if the keystroke stops here.
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter' && valid) onApply(declaredType)
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      />
    </PrimitiveDropdown.Item>
  )
}

/** Seed the length box from a declaration already on the variable. */
export const seedStringLengths = (declaredType: unknown): Record<string, string> => {
  const { base, length, valid } = parseStringLength(String(declaredType ?? ''))
  return length !== undefined && valid ? { [base]: String(length) } : {}
}
