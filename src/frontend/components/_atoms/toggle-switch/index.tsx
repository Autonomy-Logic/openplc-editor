import { cn } from '../../../utils/cn'

/**
 * Sliding toggle switch matching the S7Comm / server-editor look. Built
 * on a native checkbox (`peer sr-only`) + a styled track/thumb, so it
 * stays keyboard- and form-accessible without extra wiring.
 *
 * The wrapping `<label>` gives the input an implicit label, so clicking
 * the track toggles it. An optional `id` lets an external `<Label
 * htmlFor>` (e.g. a separate field caption) associate too.
 */

type ToggleSwitchProps = {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  id?: string
  disabled?: boolean
  'aria-label'?: string
}

function ToggleSwitch({ checked, onCheckedChange, id, disabled, 'aria-label': ariaLabel }: ToggleSwitchProps) {
  return (
    <label className={cn('relative inline-flex items-center', disabled ? 'cursor-not-allowed' : 'cursor-pointer')}>
      <input
        type='checkbox'
        id={id}
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => onCheckedChange(e.target.checked)}
        className='peer sr-only'
      />
      <div
        className={cn(
          'h-6 w-11 rounded-full bg-neutral-300 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[""]',
          'peer-checked:bg-brand peer-checked:after:translate-x-full',
          'peer-disabled:opacity-50',
          'dark:bg-neutral-700 dark:peer-checked:bg-brand',
        )}
      />
    </label>
  )
}

export { ToggleSwitch }
