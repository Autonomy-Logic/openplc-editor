import { ComponentProps } from 'react'

import { cn } from '../../../utils/cn'

type ISoftMotionIconProps = ComponentProps<'svg'> & {
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: 'w-5 h-5',
  md: 'w-8 h-8',
  lg: 'w-12 h-12',
}

/**
 * SoftMotion (CiA 402 servo axis) icon — a rounded device tile with a rotary
 * motion glyph (a circular arrow around a hub), in teal to distinguish a
 * recognized SoftMotion drive from a plain EtherCAT slave in the project tree.
 */
export const SoftMotionIcon = (props: ISoftMotionIconProps) => {
  const { className, size = 'sm', ...res } = props
  return (
    <svg
      viewBox='0 0 18 16'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      className={cn(`${sizeClasses[size]}`, className)}
      {...res}
    >
      <rect x='0.5' y='0.5' width='17' height='15' rx='3.2' fill='#0E9F8F' />
      {/* rotary arc suggesting axis rotation */}
      <path d='M12.2 5.1A4 4 0 1 0 13 8' stroke='white' strokeWidth='1.2' strokeLinecap='round' fill='none' />
      {/* arrowhead closing the arc */}
      <path
        d='M12.4 3.3L12.5 5.4L10.5 5.1'
        stroke='white'
        strokeWidth='1.2'
        strokeLinecap='round'
        strokeLinejoin='round'
        fill='none'
      />
      {/* motor hub */}
      <circle cx='9' cy='8' r='1.5' fill='white' />
    </svg>
  )
}
