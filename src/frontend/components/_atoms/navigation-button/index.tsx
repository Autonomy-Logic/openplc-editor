import type { KeyboardEvent, ReactNode } from 'react'

type NavigationButtonProps = {
  onClick: () => void
  children: ReactNode
  className?: string
  title?: string
  ariaLabel?: string
  ariaExpanded?: boolean
  ariaSelected?: boolean
  testId?: string
}

/**
 * A control that only moves the user around the screen, rendered as a `div` so it survives the
 * `fieldset` an `EditingLockBoundary` disables. Never use it for anything that writes.
 */
const NavigationButton = ({
  onClick,
  children,
  className,
  title,
  ariaLabel,
  ariaExpanded,
  ariaSelected,
  testId,
}: NavigationButtonProps) => {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onClick()
  }

  return (
    <div
      role='button'
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      data-editing-lock-exempt
      data-testid={testId}
      title={title}
      aria-label={ariaLabel}
      aria-expanded={ariaExpanded}
      aria-selected={ariaSelected}
      className={className}
    >
      {children}
    </div>
  )
}

export { NavigationButton }
