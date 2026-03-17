import { cn } from '@root/utils'
import { ComponentProps } from 'react'

type IRemoteDeviceIconProps = ComponentProps<'svg'> & {
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: 'w-5 h-5',
  md: 'w-6 h-6',
  lg: 'w-12 h-12',
}

export const RemoteDeviceIcon = (props: IRemoteDeviceIconProps) => {
  const { className, size = 'sm', ...res } = props
  return (
    <svg
      role='button'
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
      <path
        opacity='0.4'
        d='M14 10C11.2386 10 9 12.2386 9 15C9 17.7614 11.2386 20 14 20C16.7614 20 19 17.7614 19 15C19 12.2386 16.7614 10 14 10ZM14 11.5C14.4142 11.5 14.75 11.8358 14.75 12.25V14.25H16.75C17.1642 14.25 17.5 14.5858 17.5 15C17.5 15.4142 17.1642 15.75 16.75 15.75H14.75V17.75C14.75 18.1642 14.4142 18.5 14 18.5C13.5858 18.5 13.25 18.1642 13.25 17.75V15.75H11.25C10.8358 15.75 10.5 15.4142 10.5 15C10.5 14.5858 10.8358 14.25 11.25 14.25H13.25V12.25C13.25 11.8358 13.5858 11.5 14 11.5Z'
        fill='#B4D0FE'
      />
      <circle cx='14' cy='15' r='4' stroke='#B4D0FE' strokeWidth='1.5' fill='none' />
      <path d='M14 8V10M14 20V22M8 15H6M22 15H20' stroke='#B4D0FE' strokeWidth='1.5' strokeLinecap='round' />
    </svg>
  )
}
