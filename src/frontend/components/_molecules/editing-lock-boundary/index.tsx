import type { ReactNode } from 'react'

import { useIsEditingLocked } from '../../../hooks/use-editing-lock'

type EditingLockBoundaryProps = {
  children: ReactNode
  className?: string
}

const EditingLockBoundary = ({ children, className }: EditingLockBoundaryProps) => {
  const isLocked = useIsEditingLocked()

  return (
    <fieldset
      disabled={isLocked}
      data-editing-locked={isLocked ? 'true' : undefined}
      className={`m-0 h-full w-full min-w-0 border-0 p-0 ${className ?? ''}`}
    >
      {children}
    </fieldset>
  )
}

export { EditingLockBoundary }
