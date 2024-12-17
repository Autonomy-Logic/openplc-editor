import { IconStyles } from '@process:renderer/data/constants/icon-styles'
import { cn } from '@utils/cn'

import { IIconProps } from '../Types/iconTypes'

export const PlayIcon = (props: IIconProps) => {
  const { className, fill, size = 'sm', ...res } = props
  const sizeClasses = IconStyles.sizeClasses.small[size]
  return (
    <svg
      viewBox='0 0 22 22'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      className={cn(`${sizeClasses}`, className)}
      {...res}
    >
      <path d='M3.14258 11V1.57143L19.6426 11L3.14258 20.4286V11Z' fill={fill || '#B4D0FE'} />
    </svg>
  )
}
