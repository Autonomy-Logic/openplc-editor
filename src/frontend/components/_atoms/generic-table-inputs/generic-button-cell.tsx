import React from 'react'

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
  return (
    <button
      type='button'
      className={cn('flex h-full w-full cursor-pointer items-center justify-center', className)}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      {value}
    </button>
  )
}
