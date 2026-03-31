import { cn } from '@utils/cn'
import { ComponentProps } from 'react'

type IDeviceTransferIconProps = ComponentProps<'svg'> & {
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: 'w-5 h-5',
  md: 'w-8 h-8',
  lg: 'w-12 h-12',
}
export const DeviceTransferIcon = (props: IDeviceTransferIconProps) => {
  const { className, size = 'sm', ...res } = props
  return (
    <svg
      viewBox='0 0 18 16'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      className={cn(`${sizeClasses[size]}`, className)}
      {...res}
    >
      <g clipPath='url(#clip0_38_12)'>
        <path
          d='M17.5716 11.8092V5.97591C17.5716 4.13496 16.0365 2.64258 14.143 2.64258H11.8573C11.1154 2.64258 10.3936 2.40865 9.80014 1.97591L8.20014 0.809245C7.60667 0.376504 6.88484 0.142578 6.143 0.142578H3.85728C1.96373 0.142578 0.428711 1.63496 0.428711 3.47591V11.8092C0.428711 13.6502 1.96373 15.1426 3.85728 15.1426H14.143C16.0365 15.1426 17.5716 13.6502 17.5716 11.8092Z'
          fill='#023C97'
        />
        <path
          d='M6 5.91667H12M12 5.91667L10.5 4.25M12 5.91667L10.5 7.58333'
          stroke='white'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
        <path
          opacity='0.4'
          d='M12 10.0837H6M6 10.0837L7.5 8.41699M6 10.0837L7.5 11.7503'
          stroke='#B4D0FE'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
      </g>
      <defs>
        <clipPath id='clip0_38_12'>
          <rect width='18' height='16' fill='white' />
        </clipPath>
      </defs>
    </svg>
  )
}
