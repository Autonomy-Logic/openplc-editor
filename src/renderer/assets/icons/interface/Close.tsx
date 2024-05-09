import { cn } from '@root/utils'
import { ComponentPropsWithoutRef } from 'react'

const CloseIcon = (props: ComponentPropsWithoutRef<'svg'>) => {
  const { className, ...rest } = props
  return (
    <svg className={cn(className)} viewBox='0 0 28 28' fill='none' xmlns='http://www.w3.org/2000/svg' {...rest}>
      <title>Close Icon</title>
      <path d='M4 4L24 24M4 24L24 4' stroke='inherit' strokeWidth='1.5' strokeLinecap='round' />
    </svg>
  )
}

export { CloseIcon }
