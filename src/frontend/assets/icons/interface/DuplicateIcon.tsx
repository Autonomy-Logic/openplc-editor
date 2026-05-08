import { ComponentPropsWithoutRef } from 'react'

import { cn } from '../../../utils/cn'

type IDuplicateIconProps = ComponentPropsWithoutRef<'svg'> & {
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: 'w-5 h-5',
  md: 'w-6 h-6',
  lg: 'w-12 h-12',
}

export const DuplicateIcon = (props: IDuplicateIconProps) => {
  const { className, size = 'sm', color, ...res } = props
  return (
    <svg
      viewBox='0 0 24 24'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      className={cn(sizeClasses[size], className)}
      {...res}
    >
      <title>Duplicate Icon</title>
      <rect x='8' y='8' width='12' height='12' rx='2' stroke={color || '#0464FB'} strokeWidth='1.5' />
      <rect x='4' y='4' width='12' height='12' rx='2' stroke={color || '#0464FB'} strokeWidth='1.5' opacity='0.5' />
    </svg>
  )
}
