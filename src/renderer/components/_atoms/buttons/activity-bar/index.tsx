import { ComponentPropsWithoutRef } from 'react'

type IActivityBarButtonProps = ComponentPropsWithoutRef<'button'>

const ActivityBarButton = (props: IActivityBarButtonProps) => {
  const { children, ...res } = props
  return (
    <button type='button' className='flex h-6 w-full items-center justify-center' {...res}>
      <div className=' transition-all duration-150 rounded-md p-[6px] hover:bg-brand-medium dark:hover:bg-neutral-900'>{children}</div>
    </button>
  )
}

export { ActivityBarButton }
