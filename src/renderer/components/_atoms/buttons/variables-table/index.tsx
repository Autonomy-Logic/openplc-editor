import { cn } from '@root/utils'
import { ComponentPropsWithoutRef, ReactNode } from 'react'

type VariablesTableButtonProps = ComponentPropsWithoutRef<'button'> & {
  children: ReactNode
  className?: string
}

const VariablesTableButton = ({ className, children, ...props }: VariablesTableButtonProps) => {
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

export { VariablesTableButton }
