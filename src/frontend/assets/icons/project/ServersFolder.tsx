import { ComponentProps } from 'react'

import { cn } from '../../../utils/cn'

type IServersFolderIconProps = ComponentProps<'svg'> & {
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: 'w-5 h-5',
  md: 'w-6 h-6',
  lg: 'w-12 h-12',
}

export const ServersFolderIcon = (props: IServersFolderIconProps) => {
  const { className, size = 'sm', ...res } = props
  return (
    <svg
      role='button'
      viewBox='0 0 28 28'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      className={cn(`${sizeClasses[size]}`, className)}
      {...res}
    >
      <path
        d='M26 19.3333V11.1667C26 8.58934 23.851 6.5 21.2 6.5H18C16.9614 6.5 15.9509 6.1725 15.12 5.56667L12.88 3.93333C12.0491 3.3275 11.0386 3 10 3H6.8C4.14903 3 2 5.08934 2 7.66667V19.3333C2 21.9107 4.14903 24 6.8 24H21.2C23.851 24 26 21.9107 26 19.3333Z'
        fill='#023C97'
      />
      <rect x='8' y='10' width='12' height='4' rx='1' fill='#B4D0FE' opacity='0.8' />
      <rect x='8' y='16' width='12' height='4' rx='1' fill='#B4D0FE' opacity='0.8' />
      <circle cx='10' cy='12' r='1' fill='#023C97' />
      <circle cx='10' cy='18' r='1' fill='#023C97' />
    </svg>
  )
}
