import { ComponentPropsWithoutRef } from 'react'

import { cn } from '../../../../utils/cn'

type IExecuteIconProps = ComponentPropsWithoutRef<'svg'> & {
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: 'w-5 h-5',
  md: 'w-6 h-6',
  lg: 'w-12 h-12',
}

/**
 * Execute ("ST Block") toolbox icon — a rung-wired box holding lines of
 * text, echoing how the element renders on the canvas. Matches the
 * other ladder icons' rounded-square backdrop and `#B4D0FE` palette.
 */
export default function ExecuteIcon(props: IExecuteIconProps) {
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
        d='M4.66667 0H18.6667C21.244 0 23.3333 2.08934 23.3333 4.66667V18.6667C23.3333 21.244 21.244 23.3333 18.6667 23.3333H4.66667C2.08934 23.3333 0 21.244 0 18.6667V4.66667C0 2.08934 2.08934 0 4.66667 0Z'
        fill='#B4D0FE'
      />
      {/* rung wires into EN / out of ENO */}
      <path d='M2 11.6667H5.5' stroke='#B4D0FE' strokeWidth='1.35' />
      <path d='M18 11.6667H21.5' stroke='#B4D0FE' strokeWidth='1.35' />
      {/* the box */}
      <rect x='5.5' y='5.5' width='12.5' height='12.3333' rx='1.5' stroke='#B4D0FE' strokeWidth='1.35' />
      {/* lines of code */}
      <path
        d='M7.83333 9.33333H15.6667M7.83333 11.6667H13.3333M7.83333 14H14.5'
        stroke='#B4D0FE'
        strokeWidth='1.1'
        strokeLinecap='round'
      />
    </svg>
  )
}
