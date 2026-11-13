import React from 'react'

import { useIsEditingLocked } from '../../../hooks/use-editing-lock'
import { cn } from '../../../utils/cn'

export const GenericButtonCell = ({
  value,
  onClick,
  className = '',
}: {
  value: string | React.ReactNode
  onClick: () => void
  className?: string
}) => {
  const isEditingLocked = useIsEditingLocked()

  return (
    <button
      type='button'
      disabled={isEditingLocked}
      className={cn(
        'flex h-full w-full cursor-pointer items-center justify-center disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      {value}
    </button>
  )
}
