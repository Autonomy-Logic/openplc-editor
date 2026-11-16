import type { ComponentPropsWithoutRef } from 'react'

import { useIsEditingLocked } from '../../../hooks/use-editing-lock'
import { cn } from '../../../utils/cn'

type DragSourceProps = ComponentPropsWithoutRef<'div'>

const DragSource = ({ children, className, onDragStart, ...rest }: DragSourceProps) => {
  const isLocked = useIsEditingLocked()

  return (
    <div
      {...rest}
      draggable={!isLocked}
      aria-disabled={isLocked ? true : undefined}
      data-editing-locked={isLocked ? 'true' : undefined}
      onDragStart={isLocked ? undefined : onDragStart}
      className={cn(isLocked && 'cursor-not-allowed opacity-50', className)}
    >
      {children}
    </div>
  )
}

export { DragSource }
