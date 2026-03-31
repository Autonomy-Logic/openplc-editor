import { cn } from '@root/utils'
import { ComponentPropsWithoutRef } from 'react'

type IActivityBarButtonProps = ComponentPropsWithoutRef<'button'> & {
  'data-active'?: string
}

const ActivityBarButton = (props: IActivityBarButtonProps) => {
  const { children, className, 'data-active': dataActive, ...res } = props
  const isActive = dataActive === 'true'

  return (
    <button
      role='button'
      className={cn('flex h-6 w-full cursor-pointer items-center justify-center', className)}
      {...res}
    >
      <div
        className={cn(
          'rounded-md p-[6px] transition-all duration-150 hover:bg-brand-medium dark:hover:bg-neutral-900',
          isActive && 'bg-brand-medium-dark dark:bg-neutral-700',
        )}
      >
        {children}
      </div>
    </button>
  )
}

export { ActivityBarButton }
