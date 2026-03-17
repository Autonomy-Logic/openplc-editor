import { IconStyles } from '@process:renderer/data/constants/icon-styles'
import { cn } from '@utils/cn'

import { IIconProps } from '../Types/iconTypes'

export const StopIcon = (props: IIconProps) => {
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
      <rect x='5' y='5' width='12' height='12' fill={fill || 'currentColor'} />
    </svg>
  )
}
