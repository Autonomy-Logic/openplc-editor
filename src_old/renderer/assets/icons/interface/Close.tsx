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

const CloseFilledIcon = ({ className, ...rest }: ComponentPropsWithoutRef<'svg'>) => {
  return (
    <svg
      className={cn('h-6 w-6', className)}
      viewBox='0 0 28 28'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      {...rest}
    >
      <path
        opacity='0.5'
        d='M6.99998 2.33331H21C23.5773 2.33331 25.6666 4.42265 25.6666 6.99998V21C25.6666 23.5773 23.5773 25.6667 21 25.6667H6.99998C4.42265 25.6667 2.33331 23.5773 2.33331 21V6.99998C2.33331 4.42265 4.42265 2.33331 6.99998 2.33331Z'
        fill='#B4D0FE'
        fillOpacity='0.5'
      />
      <path d='M8 8L20 20M8 20L20 8' stroke='#B4D0FE' strokeWidth='0.9' strokeLinecap='round' />
    </svg>
  )
}

export { CloseFilledIcon, CloseIcon }
