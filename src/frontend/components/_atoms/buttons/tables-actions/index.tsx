import { ComponentPropsWithoutRef, ReactNode } from 'react'

import { cn } from '../../../../utils/cn'

type TableActionButtonProps = ComponentPropsWithoutRef<'button'> & {
  children: ReactNode
  className?: string
}

const TableActionButton = ({ className, children, ...props }: TableActionButtonProps) => {
  return (
    <button
      className={cn(
        'hover:cursor-pointer hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-neutral-900',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

export { TableActionButton }
