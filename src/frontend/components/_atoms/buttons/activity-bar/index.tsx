import { ComponentPropsWithoutRef, forwardRef } from 'react'

import { cn } from '../../../../utils/cn'

type IActivityBarButtonProps = ComponentPropsWithoutRef<'button'> & {
  'data-active'?: string
}

const ActivityBarButton = forwardRef<HTMLButtonElement, IActivityBarButtonProps>((props, ref) => {
  const { children, className, 'data-active': dataActive, ...res } = props
  const isActive = dataActive === 'true'

  return (
    <button
      ref={ref}
      type='button'
      className={cn('flex h-8 w-full cursor-pointer items-center justify-center', className)}
      {...res}
    >
      <div
        className={cn(
          'rounded-md p-[5px] transition-all duration-150 hover:bg-brand-medium dark:hover:bg-neutral-900',
          isActive && 'bg-brand-medium-dark dark:bg-neutral-700',
        )}
      >
        {children}
      </div>
    </button>
  )
})
ActivityBarButton.displayName = 'ActivityBarButton'

export { ActivityBarButton }
