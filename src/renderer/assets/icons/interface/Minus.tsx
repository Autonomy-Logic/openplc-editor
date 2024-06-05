import { cn } from '@utils/cn'
import { ComponentPropsWithoutRef } from 'react'

type IMinusIconProps = ComponentPropsWithoutRef<'svg'> & {
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: 'w-5 h-5',
  md: 'w-8 h-8',
  lg: 'w-12 h-12',
}

export const MinusIcon = (props: IMinusIconProps) => {
  const { className, size = 'sm', ...res } = props
  return (
    <svg
      viewBox='0 0 14 2'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      className={cn(`${sizeClasses[size]}`, className)}
      {...res}
    >
      <title>Minus Icon</title>
      <path d='M1.28571 1H12.7143' stroke='#0464FB' strokeWidth='1.5' strokeLinecap='round' />
    </svg>
  )
}
