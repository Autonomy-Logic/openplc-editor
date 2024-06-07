import { IconStyles } from '@process:renderer/data/constants/icon-styles'
import { cn } from '@utils/cn'

import { IIconProps } from '../Types/iconTypes'

export const PauseIcon = (props: IIconProps) => {
  const { className, fill, size = 'sm', ...res } = props
  const sizeClasses = IconStyles.sizeClasses.small[size]
  return (
    <svg
      viewBox='0 0 11 10'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      className={cn(`${sizeClasses}`, className)}
      {...res}
    >
      <path
        d='M0.352539 1.66683C0.352539 0.93045 0.912183 0.333496 1.60254 0.333496H2.85254C3.54289 0.333496 4.10254 0.93045 4.10254 1.66683V8.3335C4.10254 9.06988 3.54289 9.66683 2.85254 9.66683H1.60254C0.912183 9.66683 0.352539 9.06988 0.352539 8.3335V1.66683Z'
        fill='white'
      />
      <path
        d='M6.60254 1.66683C6.60254 0.93045 7.16218 0.333496 7.85254 0.333496H9.10254C9.7929 0.333496 10.3525 0.93045 10.3525 1.66683V8.3335C10.3525 9.06988 9.7929 9.66683 9.10254 9.66683H7.85254C7.16218 9.66683 6.60254 9.06988 6.60254 8.3335V1.66683Z'
        fill='white'
      />
    </svg>
  )
}
