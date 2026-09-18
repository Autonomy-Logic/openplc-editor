import { ComponentPropsWithoutRef } from 'react'

import { cn } from '../../../utils/cn'

type GlobalVariableListIconProps = ComponentPropsWithoutRef<'svg'> & {
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: 'w-5 h-5',
  md: 'w-6 h-6',
  lg: 'w-12 h-12',
}

/**
 * A Global Variable List.
 *
 * Same document body as the data-type icons — a GVL is a declaration file like they are —
 * with a globe as the glyph, which is the one thing that distinguishes it: its contents
 * are reachable from every POU in the project.
 */
export const GlobalVariableListIcon = (props: GlobalVariableListIconProps) => {
  const { className, size = 'sm', ...res } = props
  return (
    <svg
      viewBox='0 0 28 28'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      className={cn(`${sizeClasses[size]}`, className)}
      {...res}
    >
      <title>Global Variable List Icon</title>
      <path
        opacity='0.4'
        d='M3.49988 20.9997V6.99968C3.49988 4.42235 5.58922 2.33301 8.16655 2.33301L15.1665 2.33302L24.4999 11.6664V20.9997C24.4999 23.577 22.4105 25.6664 19.8332 25.6664H8.16654C5.58922 25.6664 3.49988 23.577 3.49988 20.9997Z'
        fill='#023C97'
      />
      <path
        d='M15.1661 6.99977V2.3331L24.4995 11.6664H19.8328C17.2555 11.6664 15.1661 9.5771 15.1661 6.99977Z'
        fill='#023C97'
      />
      <g stroke='#B4D0FE' strokeWidth='0.9' strokeLinecap='round' strokeLinejoin='round' fill='none'>
        <circle cx='12.75' cy='17.25' r='4.4' />
        <path d='M8.35 17.25H17.15' />
        <path d='M12.75 12.85C14.05 14.2 14.6 15.75 14.6 17.25C14.6 18.75 14.05 20.3 12.75 21.65C11.45 20.3 10.9 18.75 10.9 17.25C10.9 15.75 11.45 14.2 12.75 12.85Z' />
      </g>
      <path
        d='M17.0193 19.1291C17.0193 18.9805 16.8988 18.86 16.7501 18.86C16.6015 18.86 16.481 18.9805 16.481 19.1291V19.7622H15.8479C15.6992 19.7622 15.5787 19.8827 15.5787 20.0314C15.5787 20.18 15.6992 20.3006 15.8479 20.3006H16.481V20.9336C16.481 21.0823 16.6015 21.2028 16.7501 21.2028C16.8988 21.2028 17.0193 21.0823 17.0193 20.9336V20.3006H17.6524C17.8011 20.3006 17.9216 20.18 17.9216 20.0314C17.9216 19.8827 17.8011 19.7622 17.6524 19.7622H17.0193V19.1291Z'
        fill='white'
        stroke='white'
        strokeWidth='0.2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}
