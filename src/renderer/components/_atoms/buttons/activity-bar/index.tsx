import { ComponentPropsWithoutRef } from 'react'

type IActivityBarButtonProps = ComponentPropsWithoutRef<'button'>

const ActivityBarButton = (props: IActivityBarButtonProps) => {
  const { children, ...res } = props
  return (
    <button type='button' className='flex h-6 w-full items-center justify-center' {...res}>
      {children}
    </button>
  )
}

export { ActivityBarButton }
