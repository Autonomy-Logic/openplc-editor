import { type KeyboardEvent, useId } from 'react'

import styles from './field.module.css'

export interface TextFieldProps {
  readonly label: string
  readonly value: string
  readonly error?: string | null
  readonly disabled?: boolean
  readonly autoFocus?: boolean
  readonly onChange: (value: string) => void
  readonly onEnter?: () => void
  readonly onEscape?: () => void
}

/**
 * Controlled text input with a linked label and error message. It holds no value of its own: the caller
 * owns `value`, and Enter/Escape are reported as callbacks instead of being interpreted here.
 */
export function TextField({ label, value, error, disabled, autoFocus, onChange, onEnter, onEscape }: TextFieldProps) {
  // `useId` keeps label/input/error ids unique even when the same field renders many times.
  const id = useId()
  const errorId = `${id}-error`

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && onEnter) {
      event.preventDefault()
      onEnter()
    } else if (event.key === 'Escape' && onEscape) {
      event.preventDefault()
      onEscape()
    }
  }

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={styles.control}
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      {error ? (
        <span id={errorId} className={styles.error} role='alert'>
          {error}
        </span>
      ) : null}
    </div>
  )
}
