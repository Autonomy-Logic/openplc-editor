import { IconStyles } from '@process:renderer/data/constants/icon-styles'
import { cn } from '@utils/cn'

import { IIconProps } from '../Types/iconTypes'

export const ExitIcon = (props: IIconProps) => {
  const { className, size = 'sm', ...res } = props
  const sizeClasses = IconStyles.sizeClasses.small[size]

  return (
    <svg
      role='button'
      viewBox='0 0 28 28'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      className={cn(`${sizeClasses}`, className)}
      {...res}
    >
      <path
        d='M5.8335 14L22.1668 14M5.8335 14L12.6391 21M5.8335 14L12.6391 7'
        stroke='inherit'
        strokeWidth='1.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}
