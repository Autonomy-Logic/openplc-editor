import { IconStyles } from '@process:renderer/data/constants/icon-styles'
import { cn } from '@utils/cn'

import { IIconProps } from '../Types/iconTypes'

export default function ViewIcon(props: IIconProps) {
  const { stroke, className, size = 'sm', ...res } = props
  const sizeClasses = IconStyles.sizeClasses.small[size]

  return (
    <svg
      viewBox='0 0 15 10'
      stroke={stroke}
      xmlns='http://www.w3.org/2000/svg'
      className={cn(`${sizeClasses}`, className)}
      {...res}
    >
      <path
        fillRule='evenodd'
        clipRule='evenodd'
        d='M7.79818 9.60216C10.7081 9.66758 13.2826 7.56807 14.5769 6.28818C15.1342 5.73709 15.1529 4.9064 14.6209 4.33081C13.3855 2.99405 10.9079 0.780938 7.99799 0.715512C5.08809 0.650085 2.51353 2.7496 1.21925 4.02948C0.661948 4.58058 0.64327 5.41127 1.17524 5.98686C2.41069 7.32362 4.88828 9.53673 7.79818 9.60216ZM7.85812 6.93616C8.9024 6.95964 9.76684 6.18294 9.78891 5.20135C9.81098 4.21976 8.98232 3.40498 7.93804 3.3815C6.89377 3.35803 6.02932 4.13473 6.00725 5.11632C5.98518 6.09791 6.81384 6.91268 7.85812 6.93616Z'
        fill={stroke || '#0464FB'}
      />
    </svg>
  )
}
