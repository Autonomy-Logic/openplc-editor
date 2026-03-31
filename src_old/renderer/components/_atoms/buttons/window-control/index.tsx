import { cn } from '@root/utils'
import { ComponentPropsWithRef } from 'react'

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
