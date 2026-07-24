import { ComponentProps } from 'react'

import { cn } from '../../../utils/cn'

type IUsersIconProps = ComponentProps<'svg'> & {
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: 'w-5 h-5',
  md: 'w-6 h-6',
  lg: 'w-12 h-12',
}

export const UsersIcon = (props: IUsersIconProps) => {
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
      <circle cx='11' cy='9' r='4' fill='#023C97' />
      <path
        d='M4 22C4 18.134 7.13401 15 11 15C14.866 15 18 18.134 18 22V23C18 23.5523 17.5523 24 17 24H5C4.44772 24 4 23.5523 4 23V22Z'
        fill='#023C97'
      />
      <circle cx='20' cy='10.5' r='3' fill='#B4D0FE' />
      <path
        d='M19 16C22.3137 16 25 18.6863 25 22V22.5C25 23.3284 24.3284 24 23.5 24H20.5C20.7761 24 21 23.7761 21 23.5V22C21 19.9954 20.2159 18.1738 18.9385 16.8262C19.0252 16.8154 19.1123 16.8079 19.2 16.8038C19.1327 16.5411 19.0693 16.2734 19 16Z'
        fill='#B4D0FE'
      />
    </svg>
  )
}
