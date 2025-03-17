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

export default function ConnectorIcon(props: IBlockIconProps) {
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
      <path
        d='M11.1123 8.38636H21.75C22.227 8.38636 22.6136 8.77303 22.6136 9.25V17.75C22.6136 18.227 22.227 18.6136 21.75 18.6136H11.1123C10.8656 18.6136 10.6307 18.5081 10.4668 18.3238L6.689 14.0738C6.39814 13.7465 6.39814 13.2535 6.689 12.9262L10.4668 8.67623C10.6307 8.49185 10.8656 8.38636 11.1123 8.38636Z'
        stroke='#B4D0FE'
        stroke-width='1.22727'
      />
    </svg>
  )
}
