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

/** An operator screen: a display showing a level bar and a lamp. */
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
      <rect x='3' y='5' width='22' height='15' rx='2' fill='#023C97' />
      <rect x='7' y='12' width='4' height='5' rx='1' fill='#B4D0FE' />
      <rect x='7' y='9' width='4' height='3' rx='1' fill='#B4D0FE' opacity='0.4' />
      <circle cx='18' cy='12.5' r='3' fill='#B4D0FE' />
      <path d='M10 24H18' stroke='#023C97' strokeWidth='2' strokeLinecap='round' />
      <path d='M14 20V24' stroke='#023C97' strokeWidth='2' />
    </svg>
  )
}
