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
export default function BlockIcon(props: IBlockIconProps) {
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
        d='M6.99999 2.33333H21C23.5773 2.33333 25.6667 4.42267 25.6667 6.99999V21C25.6667 23.5773 23.5773 25.6667 21 25.6667H7C4.42267 25.6667 2.33333 23.5773 2.33333 21V7C2.33333 4.42267 4.42267 2.33333 6.99999 2.33333Z'
        fill='#B4D0FE'
      />
      <rect
        x='10.1136'
        y='8.38636'
        width='8.72727'
        height='10.2273'
        rx='0.863636'
        stroke='#B4D0FE'
        strokeWidth='1.22727'
      />
      <path
        d='M10.7273 9.25C10.7273 9.11193 10.8392 9 10.9773 9H17.9783C18.1164 9 18.2283 9.11193 18.2283 9.25V11.4545H10.7273V9.25Z'
        fill='#B4D0FE'
        fill-opacity='0.5'
      />
      <line x1='5' y1='13.2955' x2='9.90909' y2='13.2955' stroke='#B4D0FE' stroke-opacity='0.5' strokeWidth='1.22727' />
      <line x1='5' y1='16.5682' x2='9.90909' y2='16.5682' stroke='#B4D0FE' stroke-opacity='0.5' strokeWidth='1.22727' />
      <line
        x1='18.9091'
        y1='14.9318'
        x2='23.8182'
        y2='14.9318'
        stroke='#B4D0FE'
        stroke-opacity='0.5'
        strokeWidth='1.22727'
      />
    </svg>
  )
}
