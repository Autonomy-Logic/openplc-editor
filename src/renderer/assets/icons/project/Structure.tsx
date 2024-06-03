import { cn } from '@utils/cn'
import { ComponentPropsWithoutRef } from 'react'

type IStructureIconProps = ComponentPropsWithoutRef<'svg'> & {
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: 'w-5 h-5',
  md: 'w-6 h-6',
  lg: 'w-12 h-12',
}

export const StructureIcon = (props: IStructureIconProps) => {
  const { className, size = 'sm', ...res } = props
  return (
    <svg
      width='28'
      height='28'
      viewBox='0 0 28 28'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      className={cn(`${sizeClasses[size]}`, className)}
      {...res}
    >
      <title>Structure Icon</title>
      <path
        d='M26.0005 19.3333V11.1667C26.0005 8.58934 23.8515 6.5 21.2005 6.5H18.0005C16.9619 6.5 15.9514 6.1725 15.1205 5.56667L12.8805 3.93333C12.0496 3.3275 11.0391 3 10.0005 3H6.80049C4.14952 3 2.00049 5.08934 2.00049 7.66667V19.3333C2.00049 21.9107 4.14952 24 6.80049 24H21.2005C23.8515 24 26.0005 21.9107 26.0005 19.3333Z'
        fill='#023C97'
      />
      <g clipPath='url(#clip0_2002_48443)'>
        <path
          opacity='0.4'
          d='M8.75 13.5502L19.25 13.5502M12.25 10.0502L12.25 20.5502M16.45 20.5502H11.55C10.5699 20.5502 10.0799 20.5502 9.70552 20.3594C9.37623 20.1917 9.10852 19.9239 8.94074 19.5947C8.75 19.2203 8.75 18.7303 8.75 17.7502V12.8502C8.75 11.8701 8.75 11.38 8.94074 11.0057C9.10852 10.6764 9.37623 10.4087 9.70552 10.2409C10.0799 10.0502 10.5699 10.0502 11.55 10.0502H16.45C17.4301 10.0502 17.9201 10.0502 18.2945 10.2409C18.6238 10.4087 18.8915 10.6764 19.0593 11.0057C19.25 11.38 19.25 11.8701 19.25 12.8502V16.7014'
          stroke='#B4D0FE'
          strokeWidth='0.98'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
        <path
          d='M19.6273 18.3811C19.6273 18.173 19.4586 18.0043 19.2505 18.0043C19.0424 18.0043 18.8736 18.173 18.8736 18.3811L18.8736 19.2674L17.9873 19.2674C17.7792 19.2674 17.6105 19.4362 17.6105 19.6443C17.6105 19.8524 17.7792 20.0211 17.9873 20.0211L18.8736 20.0211L18.8736 20.9074C18.8736 21.1156 19.0424 21.2843 19.2505 21.2843C19.4586 21.2843 19.6273 21.1156 19.6273 20.9074L19.6273 20.0211L20.5136 20.0211C20.7218 20.0211 20.8905 19.8524 20.8905 19.6443C20.8905 19.4362 20.7218 19.2674 20.5136 19.2674L19.6273 19.2674L19.6273 18.3811Z'
          fill='white'
          stroke='white'
          strokeWidth='0.28'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
      </g>
      <defs>
        <clipPath id='clip0_2002_48443'>
          <rect width='18' height='18' fill='white' transform='translate(23.0005 4.89996) rotate(90)' />
        </clipPath>
      </defs>
    </svg>
  )
}
