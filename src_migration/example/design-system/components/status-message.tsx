import styles from './status-message.module.css'

export type StatusMessageTone = 'neutral' | 'busy' | 'warning' | 'error'

export interface StatusMessageProps {
  readonly tone: StatusMessageTone
  readonly text: string
}

/** Live status line. `role="status"` makes screen readers announce changes; `data-tone` exposes the variant. */
export function StatusMessage({ tone, text }: StatusMessageProps) {
  return (
    <p className={`${styles.status} ${styles[tone]}`} role='status' data-tone={tone}>
      {text}
    </p>
  )
}
