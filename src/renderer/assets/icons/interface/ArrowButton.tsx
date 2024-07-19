import { cn } from '@root/utils'
import React from 'react'
import { ComponentPropsWithRef, ElementType } from 'react'

type IArrowButtonIconProps = ComponentPropsWithRef<'svg'> & {
  variant?: 'default' | 'primary' | 'secondary'
  direction?: 'up' | 'down' | 'left' | 'right'
  size?: 'sm' | 'md' | 'lg'
}

const directionClasses = {
  up: 'rotate-0',
  left: 'rotate-90',
  down: 'rotate-180',
  right: 'rotate-270',
}

const variantClasses = {
  default: 'stroke-brand-light',
  primary: 'stroke-brand',
  secondary: 'stroke-brand-medium-dark',
}

const sizeClasses = {
  sm: 'w-3 h-3',
  md: 'w-5 h-5',
  lg: 'w-7 h-7',
}
const ArrowButton: ElementType<IArrowButtonIconProps> = ({
  className,
  variant = 'default',
  size = 'sm',
  direction = 'left',
  ref,
  ...res
}) => {
  return (
    <svg
      className={cn(`${variantClasses[variant]}`, `${directionClasses[direction]}`, `${sizeClasses[size]}`, className)}
      viewBox='0 0 13 9'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      aria-label='Arrow Button'
      ref={ref}
      {...res}
    >
      <path d='M6.49993 0.704102L12.7333 8.8641H0.266602L6.49993 0.704102Z' fill='#011E4B' />
    </svg>
  )
}

export default ArrowButton
