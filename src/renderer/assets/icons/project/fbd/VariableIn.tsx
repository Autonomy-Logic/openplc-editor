import { cn } from '@utils/cn'
import { ComponentPropsWithoutRef } from 'react'

type IBlockIconProps = ComponentPropsWithoutRef<'svg'> & {
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: 'w-5 h-5',
  md: 'w-6 h-6',
  lg: 'w-12 h-12',
}

export default function VariableInIcon(props: IBlockIconProps) {
  const { className, size = 'sm', ...res } = props
  return (
    <svg
      className={cn(sizeClasses[size], className)}
      viewBox='0 0 28 28'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      {...res}
    >
      <path
        opacity='0.4'
        d='M7 2.33333H21C23.5773 2.33333 25.6667 4.42267 25.6667 6.99999V21C25.6667 23.5773 23.5773 25.6667 21 25.6667H7C4.42267 25.6667 2.33333 23.5773 2.33333 21V7C2.33333 4.42267 4.42267 2.33333 7 2.33333Z'
        fill='#B4D0FE'
      />
      <rect
        x='9.38636'
        y='8.38636'
        width='8.72727'
        height='10.2273'
        rx='0.863636'
        stroke='#B4D0FE'
        stroke-width='1.22727'
      />
      <line
        x1='18'
        y1='13.3864'
        x2='22.9091'
        y2='13.3864'
        stroke='#B4D0FE'
        stroke-opacity='0.5'
        stroke-width='1.22727'
      />
    </svg>
  )
}
