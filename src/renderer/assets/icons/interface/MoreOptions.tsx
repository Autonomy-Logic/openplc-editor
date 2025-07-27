import { cn } from '@root/utils'
import { ComponentPropsWithoutRef } from 'react'

const MoreOptionsIcon = ({ className, ...rest }: ComponentPropsWithoutRef<'svg'>) => {
  return (
    <svg
      className={cn('h-6 w-6', className)}
      viewBox='0 0 24 24'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      {...rest}
    >
      <circle cx='12' cy='5' r='1.5' fill='currentColor' />
      <circle cx='12' cy='12' r='1.5' fill='currentColor' />
      <circle cx='12' cy='19' r='1.5' fill='currentColor' />
    </svg>
  )
}

export { MoreOptionsIcon }