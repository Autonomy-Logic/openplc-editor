import { IconStyles } from '@process:renderer/data/constants/icon-styles'
import { cn } from '@utils/cn'

import { IIconProps } from '../Types/iconTypes'

export const DebuggerIcon = (props: IIconProps) => {
  const { className, fill, size = 'sm', ...res } = props
  const sizeClasses = IconStyles.sizeClasses.small[size]
  return (
    <svg
      viewBox='0 0 23 23'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      className={cn(`${sizeClasses}`, className)}
      {...res}
    >
      <title>Debugger Icon</title>
      <path
        fillRule='evenodd'
        clipRule='evenodd'
        d='M17.3659 19.5263L20.9197 21.0457L21.4533 19.7975L17.974 18.3099C17.8209 18.7382 17.6165 19.1456 17.3659 19.5263ZM18.3016 13.9739L21.5404 14.5434L21.7755 13.2065L18.3016 12.5956V13.9739ZM4.09018 18.3109C4.2434 18.7391 4.4479 19.1465 4.6985 19.5272L1.14661 21.0458L0.61294 19.7976L4.09018 18.3109ZM3.76228 12.5961V13.9744L0.525873 14.5435L0.290771 13.2066L3.76228 12.5961Z'
        fill={fill || '#B4D0FE'}
      />
      <path
        opacity='0.4'
        fillRule='evenodd'
        clipRule='evenodd'
        d='M10.1935 22.4988C6.43991 22.259 3.7627 19.6253 3.7627 16.4115V10.7761V8.89758H10.1935V22.4988ZM11.8712 22.4988C15.6248 22.259 18.302 19.6253 18.302 16.4115V10.7761V8.89758H11.8712V22.4988Z'
        fill={fill || '#B4D0FE'}
      />
      <path
        fillRule='evenodd'
        clipRule='evenodd'
        d='M8.91488 2.88283C9.58493 2.70668 10.296 2.61195 11.0326 2.61195C11.7689 2.61195 12.4797 2.7066 13.1494 2.88259V0.516724H14.5069V3.37491C16.0616 4.10768 17.2727 5.31695 17.8776 6.7758L21.3697 5.14029L21.9455 6.36962L18.2447 8.10288C18.2827 8.36318 18.3023 8.62845 18.3023 8.89766H3.76295C3.76295 8.62843 3.78253 8.36315 3.82052 8.10283L0.119873 6.36962L0.695632 5.14029L4.18759 6.77576C4.79244 5.3172 6.00314 4.10813 7.5574 3.37533V0.516724H8.91488V2.88283Z'
        fill={fill || '#B4D0FE'}
      />
      <path
        d='M11.8715 8.89771H10.1938V22.499C10.3784 22.5108 10.8445 22.5168 11.0327 22.5168C11.2208 22.5168 11.6869 22.5108 11.8715 22.499V8.89771Z'
        fill={fill || '#B4D0FE'}
      />
    </svg>
  )
}
