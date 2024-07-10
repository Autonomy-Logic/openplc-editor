import { cn } from '@root/utils'
import { ComponentPropsWithoutRef, ReactNode } from 'react'

type TableActionButtonProps = ComponentPropsWithoutRef<'button'> & {
  children: ReactNode
  className?: string
}

const TableActionButton = ({ className, children, ...props }: TableActionButtonProps) => {
  return (
    <button
      className={cn(
        'hover:cursor-pointer hover:bg-neutral-100 disabled:pointer-events-none disabled:opacity-30 dark:hover:bg-neutral-900',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

export { TableActionButton }
