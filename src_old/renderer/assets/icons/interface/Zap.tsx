import { IconStyles } from '@process:renderer/data/constants/icon-styles'
import { cn } from '@utils/cn'

import { IIconProps } from '../Types/iconTypes'

export default function ZapIcon(props: IIconProps) {
  const { className, size = 'sm', ...res } = props
  const sizeClasses = IconStyles.sizeClasses.small[size]
  return (
    <svg
      viewBox='0 0 12 16'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      className={cn(`${sizeClasses}`, className)}
      {...res}
    >
      <path
        d='M7.91539 0.676899C7.94016 0.478732 7.69114 0.370634 7.56329 0.524055L0.273364 9.27196C0.16481 9.40223 0.257441 9.6 0.427008 9.6H4.57344C4.69374 9.6 4.78682 9.70544 4.7719 9.82481L4.08461 15.3231C4.05984 15.5213 4.30886 15.6294 4.43671 15.4759L11.7266 6.72804C11.8352 6.59777 11.7426 6.4 11.573 6.4H7.42656C7.30626 6.4 7.21318 6.29456 7.2281 6.17519L7.91539 0.676899Z'
        fill='#0464FB'
      />
    </svg>
  )
}
