import { ComponentProps } from 'react'

import { cn } from '../../../utils/cn'

type IHmiScreenIconProps = ComponentProps<'svg'> & {
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: 'w-5 h-5',
  md: 'w-6 h-6',
  lg: 'w-12 h-12',
}

/** An HMI screen: a panel with a gauge, in the project tree's icon style. */
export const HmiScreenIcon = (props: IHmiScreenIconProps) => {
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
      <rect x='2.5' y='4' width='23' height='16' rx='3.5' fill='#023C97' />
      <path d='M8 15.5a4 4 0 0 1 8 0' stroke='#B4D0FE' strokeWidth='1.8' strokeLinecap='round' />
      <path d='M12 15.5l2-2.6' stroke='#B4D0FE' strokeWidth='1.6' strokeLinecap='round' />
      <rect x='18' y='8.5' width='3' height='7' rx='1' fill='#B4D0FE' opacity='0.7' />
      <path d='M10 24h8M14 20v4' stroke='#023C97' strokeWidth='1.8' strokeLinecap='round' />
    </svg>
  )
}
