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

export default function ContinuationIcon(props: IBlockIconProps) {
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
        d='M7 2.33333H21C23.5773 2.33333 25.6667 4.42267 25.6667 6.99999V21C25.6667 23.5773 23.5773 25.6667 21 25.6667H7C4.42267 25.6667 2.33334 23.5773 2.33334 21V7C2.33334 4.42267 4.42267 2.33333 7 2.33333Z'
        fill='#B4D0FE'
      />
      <path
        d='M17.8877 8.38636H7.25C6.77303 8.38636 6.38636 8.77303 6.38636 9.25V17.75C6.38636 18.227 6.77303 18.6136 7.25 18.6136H17.8877C18.1344 18.6136 18.3693 18.5081 18.5332 18.3238L22.311 14.0738C22.6019 13.7465 22.6019 13.2535 22.311 12.9262L18.5332 8.67623C18.3693 8.49185 18.1344 8.38636 17.8877 8.38636Z'
        stroke='#B4D0FE'
        strokeWidth='1.22727'
      />
    </svg>
  )
}
