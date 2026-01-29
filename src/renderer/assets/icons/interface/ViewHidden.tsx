import { IconStyles } from '@process:renderer/data/constants/icon-styles'
import { cn } from '@utils/cn'

import { IIconProps } from '../Types/iconTypes'

export default function ViewHiddenIcon(props: IIconProps) {
  const { stroke, className, size = 'sm', ...res } = props
  const sizeClasses = IconStyles.sizeClasses.small[size]

  return (
    <svg
      viewBox='0 0 15 12'
      stroke={stroke}
      xmlns='http://www.w3.org/2000/svg'
      className={cn(`${sizeClasses}`, className)}
      {...res}
    >
      {/* Eye shape */}
      <path
        fillRule='evenodd'
        clipRule='evenodd'
        d='M7.79818 10.60216C10.7081 10.66758 13.2826 8.56807 14.5769 7.28818C15.1342 6.73709 15.1529 5.9064 14.6209 5.33081C13.3855 3.99405 10.9079 1.780938 7.99799 1.715512C5.08809 1.650085 2.51353 3.7496 1.21925 5.02948C0.661948 5.58058 0.64327 6.41127 1.17524 6.98686C2.41069 8.32362 4.88828 10.53673 7.79818 10.60216ZM7.85812 7.93616C8.9024 7.95964 9.76684 7.18294 9.78891 6.20135C9.81098 5.21976 8.98232 4.40498 7.93804 4.3815C6.89377 4.35803 6.02932 5.13473 6.00725 6.11632C5.98518 7.09791 6.81384 7.91268 7.85812 7.93616Z'
        fill={stroke || '#0464FB'}
      />
      {/* Diagonal line through the eye */}
      <line x1='2' y1='11' x2='13' y2='1' stroke={stroke || '#0464FB'} strokeWidth='1.5' strokeLinecap='round' />
    </svg>
  )
}
