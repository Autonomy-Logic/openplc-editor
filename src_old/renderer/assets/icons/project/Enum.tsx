import { cn } from '@utils/cn'
import { ComponentPropsWithoutRef } from 'react'

type EnumIconProps = ComponentPropsWithoutRef<'svg'> & {
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: 'w-5 h-5',
  md: 'w-6 h-6',
  lg: 'w-12 h-12',
}

export const EnumIcon = (props: EnumIconProps) => {
  const { className, size = 'sm', ...res } = props
  return (
    <svg
      viewBox='0 0 28 28'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      className={cn(`${sizeClasses[size]}`, className)}
      {...res}
    >
      <title>Enum Icon</title>
      <path
        opacity='0.4'
        d='M3.49988 20.9997V6.99968C3.49988 4.42235 5.58922 2.33301 8.16655 2.33301L15.1665 2.33302L24.4999 11.6664V20.9997C24.4999 23.577 22.4105 25.6664 19.8332 25.6664H8.16654C5.58922 25.6664 3.49988 23.577 3.49988 20.9997Z'
        fill='#023C97'
      />
      <path
        d='M15.1661 6.99977V2.3331L24.4995 11.6664H19.8328C17.2555 11.6664 15.1661 9.5771 15.1661 6.99977Z'
        fill='#023C97'
      />
      <path
        opacity='0.4'
        d='M13.5 13.373H18.6199'
        stroke='#B4D0FE'
        strokeWidth='0.75'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        opacity='0.4'
        d='M13.5854 15.373H18.62'
        stroke='#B4D0FE'
        strokeWidth='0.75'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M11.25 15.623H10H10.625V13.123L10 13.748'
        stroke='white'
        strokeWidth='0.75'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        opacity='0.4'
        d='M13.5 17.873H18.6199'
        stroke='#B4D0FE'
        strokeWidth='0.75'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        opacity='0.4'
        d='M13.5854 19.873H18.62'
        stroke='#B4D0FE'
        strokeWidth='0.75'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M10 17.623H11.25V18.623L10 19.373V20.123H11.375'
        stroke='white'
        strokeWidth='0.75'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}
