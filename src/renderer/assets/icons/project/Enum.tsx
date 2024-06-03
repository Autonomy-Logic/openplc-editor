import { cn } from '@utils/cn'
import { ComponentPropsWithoutRef } from 'react'

type IEnumIconProps = ComponentPropsWithoutRef<'svg'> & {
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: 'w-5 h-5',
  md: 'w-6 h-6',
  lg: 'w-12 h-12',
}

export const EnumIcon = (props: IEnumIconProps) => {
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
        d='M26.0005 19.3333V11.1667C26.0005 8.58934 23.8515 6.5 21.2005 6.5H18.0005C16.9619 6.5 15.9514 6.1725 15.1205 5.56667L12.8805 3.93333C12.0496 3.3275 11.0391 3 10.0005 3H6.80049C4.14952 3 2.00049 5.08934 2.00049 7.66667V19.3333C2.00049 21.9107 4.14952 24 6.80049 24H21.2005C23.8515 24 26.0005 21.9107 26.0005 19.3333Z'
        fill='#023C97'
      />
      <g clipPath='url(#clip0_2002_48373)'>
        <path
          opacity='0.4'
          d='M13.3003 10.3217H20.4681'
          stroke='#B4D0FE'
          strokeWidth='1.05'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
        <path
          opacity='0.4'
          d='M13.4199 13.1217H20.4683'
          stroke='#B4D0FE'
          strokeWidth='1.05'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
        <path
          d='M10.1499 13.4717H8.3999H9.2749V9.97174L8.3999 10.8467'
          stroke='white'
          strokeWidth='1.05'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
        <path
          opacity='0.4'
          d='M13.3003 16.6217H20.4681'
          stroke='#B4D0FE'
          strokeWidth='1.05'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
        <path
          opacity='0.4'
          d='M13.4199 19.4217H20.4683'
          stroke='#B4D0FE'
          strokeWidth='1.05'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
        <path
          d='M8.3999 16.2717H10.1499V17.6717L8.3999 18.7217V19.7717H10.3249'
          stroke='white'
          strokeWidth='1.05'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
      </g>
      <defs>
        <clipPath id='clip0_2002_48373'>
          <rect width='18' height='18' fill='white' transform='translate(23.0005 4.99994) rotate(90)' />
        </clipPath>
      </defs>
    </svg>
  )
}
