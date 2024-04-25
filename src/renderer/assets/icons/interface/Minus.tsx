import { cn } from '@utils/cn'
import { ComponentProps } from 'react'

type IMinusIconProps = ComponentProps<'svg'> & {
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
      role='button'
      viewBox='0 0 14 2'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      className={cn(`${sizeClasses[size]}`, className)}
      {...res}
    >
      <path d='M1.28571 1H12.7143' stroke='#0464FB' strokeWidth='1.5' strokeLinecap='round' />
    </svg>
  )
}
