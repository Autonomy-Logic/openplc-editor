import { useId } from 'react'

import styles from './field.module.css'

export interface SelectFieldProps {
  readonly label: string
  readonly value: string
  readonly options: readonly string[]
  readonly disabled?: boolean
  readonly onChange: (value: string) => void
}

/** Controlled select. Options are plain strings; mapping them to typed values is the caller's job. */
export function SelectField({ label, value, options, disabled, onChange }: SelectFieldProps) {
  const id = useId()
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className={styles.control}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  )
}
