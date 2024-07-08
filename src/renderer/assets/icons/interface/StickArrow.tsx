import { cn } from '@utils/cn'
import { ComponentPropsWithoutRef } from 'react'

type IStickArrowIconProps = ComponentPropsWithoutRef<'svg'> & {
  size?: 'sm' | 'md' | 'lg'
  direction?: 'up' | 'down' | 'left' | 'right'
}

const sizeClasses = {
  sm: 'w-5 h-5',
  md: 'w-8 h-8',
  lg: 'w-12 h-12',
}

const directionClasses = {
  up: 'rotate-270',
  down: 'rotate-90',
  left: 'rotate-180',
  right: 'rotate-0',
}

export const StickArrowIcon = (props: IStickArrowIconProps) => {
  const { className, size = 'sm', direction = 'up', ...res } = props
  return (
    <svg
      viewBox='0 0 28 28'
      fill='inherit'
      xmlns='http://www.w3.org/2000/svg'
      className={cn(`${sizeClasses[size]} ${directionClasses[direction]}`, className)}
      {...res}
    >
      <title>Stick Arrow Icon</title>
      <path
        d='M22.1667 13.9999H5.8333M22.1667 13.9999L15.3611 6.9999M22.1667 13.9999L15.3611 20.9999'
        stroke='inherit'
        strokeWidth='1.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}
