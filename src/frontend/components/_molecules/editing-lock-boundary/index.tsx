import type { ReactNode } from 'react'

import { useIsEditingLocked } from '../../../hooks/use-editing-lock'
import { editorLockPolicy } from '../../../store/slices/editor/lock-policy'
import type { EditorModel } from '../../../store/slices/editor/types'
import { cn } from '../../../utils/cn'

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
      className={cn('m-0 h-full w-full min-w-0 border-0 p-0', className)}
    >
      {children}
    </fieldset>
  )
}

/** Wraps an editor the policy marks `host-locked`, and leaves every other policy untouched. */
const HostLockBoundary = ({ type, children }: { type: EditorModel['type']; children: ReactNode }) =>
  editorLockPolicy(type) === 'host-locked' ? <EditingLockBoundary>{children}</EditingLockBoundary> : <>{children}</>

export { EditingLockBoundary, HostLockBoundary }
