import { ComponentPropsWithoutRef } from 'react'

type IActivityBarButtonProps = ComponentPropsWithoutRef<'button'>

const ActivityBarButton = (props: IActivityBarButtonProps) => {
  const { children, ...res } = props
  return (
    <button type='button' className='w-full h-6 flex items-center justify-center' {...res}>
      {children}
    </button>
  )
}

export { ActivityBarButton }
