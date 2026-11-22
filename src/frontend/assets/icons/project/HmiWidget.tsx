import { ComponentProps } from 'react'

import { cn } from '../../../utils/cn'

type IHmiWidgetIconProps = ComponentProps<'svg'> & {
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: 'w-5 h-5',
  md: 'w-6 h-6',
  lg: 'w-12 h-12',
}

/** A widget block: a gauge. */
export const HmiWidgetIcon = (props: IHmiWidgetIconProps) => {
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
      <path d='M5 19A9 9 0 1 1 23 19' stroke='#023C97' strokeWidth='3' strokeLinecap='round' />
      <path d='M5 19A9 9 0 0 1 9.5 11.2' stroke='#B4D0FE' strokeWidth='3' strokeLinecap='round' />
      <path d='M14 19L18 13' stroke='#023C97' strokeWidth='2' strokeLinecap='round' />
      <circle cx='14' cy='19' r='2' fill='#023C97' />
    </svg>
  )
}
