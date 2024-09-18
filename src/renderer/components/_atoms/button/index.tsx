import { cn } from '@utils/cn'
import { ComponentPropsWithRef, ReactNode } from 'react'

type IButtonProps = ComponentPropsWithRef<'button'> & {
  ghosted?: boolean
  children?: ReactNode
}

const GhostedClasses =
  'bg-transparent focus:bg-transparent text-neutral-1000 hover:text-brand hover:bg-transparent dark:text-white justify-start hover:opacity-90 font-medium'

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
