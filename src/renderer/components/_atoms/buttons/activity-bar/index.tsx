import { ComponentPropsWithoutRef } from 'react'

type IActivityBarButtonProps = ComponentPropsWithoutRef<'div'>

const ActivityBarButton = (props: IActivityBarButtonProps) => {
  const { children, ...res } = props
  return (
    <div role='button'  className='flex h-6 w-full cursor-pointer items-center justify-center' {...res}>
      <div className='rounded-md p-[6px] transition-all duration-150 hover:bg-brand-medium dark:hover:bg-neutral-900'>
        {children}
      </div>
    </div>
  )
}

export { ActivityBarButton }
