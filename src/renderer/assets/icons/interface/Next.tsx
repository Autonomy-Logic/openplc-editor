import { IconStyles } from '@process:renderer/data/constants/icon-styles'
import { cn } from '@utils/cn'

import { IIconProps } from '../Types/iconTypes'

export default function NextIcon(props: IIconProps) {
  const { className, fill, size = 'sm', ...res } = props
  const sizeClasses = IconStyles.sizeClasses.small[size]
  return (
    <svg
      viewBox='0 0 15 10'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      className={cn(`${sizeClasses}`, className)}
      {...res}
    >
      <path
        opacity='0.4'
        d='M0.123779 4.99999V1.3221C0.123779 0.78234 0.70929 0.44604 1.17552 0.718008L7.48047 4.3959C7.9431 4.66576 7.9431 5.33421 7.48047 5.60407L1.17552 9.28196C0.709291 9.55393 0.123779 9.21763 0.123779 8.67787V4.99999Z'
        fill='#B4D0FE'
      />
      <path
        fill-rule='evenodd'
        clip-rule='evenodd'
        d='M5.71875 1.32199V4.99988V8.67777C5.71875 9.21753 6.30426 9.55383 6.77049 9.28186L12.7123 5.81581V8.49666C12.7123 8.8829 13.0254 9.19602 13.4116 9.19602C13.7979 9.19602 14.111 8.8829 14.111 8.49666V1.5031C14.111 1.11685 13.7979 0.803741 13.4116 0.803741C13.0254 0.803741 12.7123 1.11685 12.7123 1.5031V4.18395L6.77049 0.717902C6.30426 0.445935 5.71875 0.782235 5.71875 1.32199Z'
        fill='#B4D0FE'
      />
    </svg>
  )
}
