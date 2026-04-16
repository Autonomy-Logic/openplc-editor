import { ComponentPropsWithRef } from 'react'

import { cn } from '../../../../utils/cn'

type WindowControlButtonProps = ComponentPropsWithRef<'button'>

const WindowControlButton = (props: WindowControlButtonProps) => {
  const { children, className, ...res } = props
  return (
    <button type='button' className={cn('flex h-full items-center justify-center px-[10px]', className)} {...res}>
      {children}
    </button>
  )
}

export { WindowControlButton }
