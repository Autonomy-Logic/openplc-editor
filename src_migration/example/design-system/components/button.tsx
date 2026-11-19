import type { ReactNode } from 'react'

import styles from './button.module.css'

/** Visual variants are a typed prop, not free-form class names passed by each caller. */
export type ButtonTone = 'primary' | 'neutral' | 'danger'

export interface ButtonProps {
  readonly tone?: ButtonTone
  readonly type?: 'button' | 'submit'
  readonly disabled?: boolean
  /** Accessible name when the visible text alone is ambiguous, e.g. "Remove" on every row. */
  readonly label?: string
  readonly onClick?: () => void
  readonly children: ReactNode
}

/** Design-system primitive: structure and accessibility here, appearance in `button.module.css`. */
export function Button({ tone = 'neutral', type = 'button', disabled, label, onClick, children }: ButtonProps) {
  return (
    <button
      type={type}
      className={`${styles.button} ${styles[tone]}`}
      disabled={disabled}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
