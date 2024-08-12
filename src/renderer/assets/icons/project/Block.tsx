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
      viewBox='0 0 24 24'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      {...res}
    >
      <path
        opacity='0.4'
        d='M5.00065 0.333984H19.0007C21.578 0.333984 23.6673 2.42332 23.6673 5.00065V19.0007C23.6673 21.578 21.578 23.6673 19.0007 23.6673H5.00065C2.42332 23.6673 0.333984 21.578 0.333984 19.0007V5.00065C0.333984 2.42332 2.42332 0.333984 5.00065 0.333984Z'
        fill='#B4D0FE'
      />
      <rect
        x='8.11364'
        y='7.38636'
        width='8.72727'
        height='10.2273'
        rx='0.863636'
        stroke='#B4D0FE'
        strokeWidth='1.22727'
      />
      <path
        d='M8.72727 8.25C8.72727 8.11193 8.8392 8 8.97727 8H15.9783C16.1164 8 16.2283 8.11193 16.2283 8.25V10.4545H8.72727V8.25Z'
        fill='#B4D0FE'
        fillOpacity='0.5'
      />
      <line
        x1='3'
        y1='12.2955'
        x2='7.90909'
        y2='12.2955'
        stroke='#B4D0FE'
        strokeOpacity='0.5'
        strokeWidth='1.22727'
      />
      <line
        x1='3'
        y1='15.5682'
        x2='7.90909'
        y2='15.5682'
        stroke='#B4D0FE'
        strokeOpacity='0.5'
        strokeWidth='1.22727'
      />
      <line
        x1='16.9091'
        y1='13.9318'
        x2='21.8182'
        y2='13.9318'
        stroke='#B4D0FE'
        strokeOpacity='0.5'
        strokeWidth='1.22727'
      />
    </svg>
  )
}
