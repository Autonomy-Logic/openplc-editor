import { cn } from '@utils/cn'
import { ComponentProps, ReactNode } from 'react'

type IButtonProps = ComponentProps<'button'> & {
  ghosted?: boolean
  children?: ReactNode
}

// This is being moved
const GhostedClasses =
  'bg-transparent dark:text-white text-neutral-1000 font-medium hover:bg-transparent hover:text-brand hover:opacity-90 justify-start'

const Button = (props: IButtonProps) => {
  const { children, ghosted, className, ...res } = props
  return (
    <button
      type='button'
      className={cn(
        `flex h-12 w-48 items-center gap-3 rounded-md bg-brand px-5 py-3 font-caption text-xl font-normal text-white hover:bg-brand-medium-dark focus:bg-brand-medium
				${ghosted ? GhostedClasses : ''}`,
        className,
      )}
      {...res}
    >
      {children}
    </button>
  )
}

export { Button }
