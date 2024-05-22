import { cn } from '@utils/cn'
import { ComponentPropsWithoutRef } from 'react'

type IArrayIconProps = ComponentPropsWithoutRef<'svg'> & {
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: 'w-5 h-5',
  md: 'w-6 h-6',
  lg: 'w-12 h-12',
}

export const ArrayIcon = (props: IArrayIconProps) => {
  const { className, size = 'sm', ...res } = props
  return (
    <svg
      viewBox='0 0 28 28'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      className={cn(`${sizeClasses[size]}`, className)}
      {...res}
    >
      <title> Array Icon</title>
      <path
        d='M26.0005 19.3333V11.1667C26.0005 8.58934 23.8515 6.5 21.2005 6.5H18.0005C16.9619 6.5 15.9514 6.1725 15.1205 5.56667L12.8805 3.93333C12.0496 3.3275 11.0391 3 10.0005 3H6.80049C4.14952 3 2.00049 5.08934 2.00049 7.66667V19.3333C2.00049 21.9107 4.14952 24 6.80049 24H21.2005C23.8515 24 26.0005 21.9107 26.0005 19.3333Z'
        fill='#023C97'
      />
      <g clipPath='url(#clip0_2002_48412)'>
        <path
          d='M12.8105 17.1716H15.1899'
          stroke='white'
          strokeWidth='0.746567'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
        <path
          d='M16.0821 16.2794V13.9'
          stroke='white'
          strokeWidth='0.746567'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
        <path
          fillRule='evenodd'
          clipRule='evenodd'
          d='M15.1899 13.3052V12.7104C15.1899 12.3819 15.4562 12.1156 15.7847 12.1156H16.3795C16.708 12.1156 16.9744 12.3819 16.9744 12.7104V13.3052C16.9744 13.6337 16.708 13.9 16.3795 13.9H15.7847C15.4562 13.9 15.1899 13.6337 15.1899 13.3052Z'
          stroke='white'
          strokeWidth='0.746567'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
        <path
          fillRule='evenodd'
          clipRule='evenodd'
          d='M16.9744 16.8742V17.469C16.9744 17.7975 16.708 18.0638 16.3795 18.0638H15.7847C15.4562 18.0638 15.1899 17.7975 15.1899 17.469V16.8742C15.1899 16.5457 15.4562 16.2794 15.7847 16.2794H16.3795C16.708 16.2794 16.9744 16.5457 16.9744 16.8742Z'
          stroke='white'
          strokeWidth='0.746567'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
        <path
          d='M15.1899 13.0078H12.8105'
          stroke='white'
          strokeWidth='0.746567'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
        <path
          d='M11.918 16.2794V13.9'
          stroke='white'
          strokeWidth='0.746567'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
        <path
          fillRule='evenodd'
          clipRule='evenodd'
          d='M11.0259 13.3052V12.7104C11.0259 12.3819 11.2922 12.1156 11.6207 12.1156H12.2155C12.544 12.1156 12.8103 12.3819 12.8103 12.7104V13.3052C12.8103 13.6337 12.544 13.9 12.2155 13.9H11.6207C11.2922 13.9 11.0259 13.6337 11.0259 13.3052Z'
          stroke='white'
          strokeWidth='0.746567'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
        <path
          fillRule='evenodd'
          clipRule='evenodd'
          d='M12.8103 16.8742V17.469C12.8103 17.7975 12.544 18.0638 12.2155 18.0638H11.6207C11.2922 18.0638 11.0259 17.7975 11.0259 17.469V16.8742C11.0259 16.5457 11.2922 16.2794 11.6207 16.2794H12.2155C12.544 16.2794 12.8103 16.5457 12.8103 16.8742Z'
          stroke='white'
          strokeWidth='0.746567'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
        <rect
          opacity='0.4'
          x='8.64697'
          y='9.73657'
          width='10.7065'
          height='10.7065'
          rx='2.97278'
          stroke='#B4D0FE'
          strokeWidth='0.891834'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
      </g>
      <defs>
        <clipPath id='clip0_2002_48412'>
          <rect width='18' height='18' fill='white' transform='translate(23.0005 4.99994) rotate(90)' />
        </clipPath>
      </defs>
    </svg>
  )
}
