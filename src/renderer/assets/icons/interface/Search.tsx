import { IconStyles } from '@process:renderer/data/constants/icon-styles'
import { cn } from '@utils/cn'

import { IIconProps } from '../Types/iconTypes'

export const SearchIcon = (props: IIconProps) => {
  const { className, size = 'sm', ...res } = props
  const sizeClasses = IconStyles.sizeClasses.small[size]

  return (
    <svg
      viewBox='0 0 24 24'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      className={cn(`${sizeClasses}`, className)}
      {...res}
    >
      <g opacity='0.4'>
        <path
          d='M19.7345 22.9923C20.6341 23.8919 22.0927 23.8919 22.9923 22.9923C23.8919 22.0927 23.8919 20.6341 22.9923 19.7345L18.417 15.1592L15.1592 18.417L19.7345 22.9923Z'
          fill='#B4D1FE'
        />
      </g>
      <circle cx='10.834' cy='10.8335' r='10.5' transform='rotate(180 10.834 10.8335)' fill='#B4D1FE' />
    </svg>
  )
}
