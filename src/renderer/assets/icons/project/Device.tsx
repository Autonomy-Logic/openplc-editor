import { cn } from '@utils/cn'
import { ComponentProps } from 'react'

type IDeviceIconProps = ComponentProps<'svg'> & {
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: 'w-5 h-5',
  md: 'w-6 h-6',
  lg: 'w-12 h-12',
}

export const DeviceIcon = (props: IDeviceIconProps) => {
  const { className, size = 'sm', ...res } = props
  return (
    <svg
      viewBox='0 0 28 28'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      className={cn(`${sizeClasses[size]}`, className)}
      {...res}
    >
      <path
        d='M26 19.3333V11.1667C26 8.58934 23.851 6.5 21.2 6.5H18C16.9614 6.5 15.9509 6.1725 15.12 5.56667L12.88 3.93333C12.0491 3.3275 11.0386 3 10 3H6.8C4.14903 3 2 5.08934 2 7.66667V19.3333C2 21.9107 4.14903 24 6.8 24H21.2C23.851 24 26 21.9107 26 19.3333Z'
        fill='#023C97'
      />
      <path opacity='0.4' d='M10.4286 14V9.71429L17.9286 14L10.4286 18.2857V14Z' fill='#B4D0FE' />
      <path
        d='M16.8368 16.2368C16.8368 16.0508 16.686 15.9 16.5 15.9C16.314 15.9 16.1632 16.0508 16.1632 16.2368V17.1632H15.2368C15.0508 17.1632 14.9 17.314 14.9 17.5C14.9 17.686 15.0508 17.8368 15.2368 17.8368H16.1632V18.7632C16.1632 18.9492 16.314 19.1 16.5 19.1C16.686 19.1 16.8368 18.9492 16.8368 18.7632V17.8368H17.7632C17.9492 17.8368 18.1 17.686 18.1 17.5C18.1 17.314 17.9492 17.1632 17.7632 17.1632H16.8368V16.2368Z'
        fill='white'
        stroke='white'
        strokeWidth='0.2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}
