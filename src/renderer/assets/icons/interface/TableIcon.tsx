import { IconStyles } from '@process:renderer/data'
import { cn } from '@utils/cn'
import { ComponentProps } from 'react'

import { IIconProps } from '../Types/iconTypes'

type IProps = ComponentProps<'svg'> & {
  size?: 'sm' | 'md' | 'lg'
  currentVisible?: boolean
  backgroundVariant?: 'light' | 'dark'
}

export const TableIcon = (props: IProps) => {
  const { currentVisible, backgroundVariant = 'light', className, size = 'sm', ...res } = props
  const sizeClasses = IconStyles.sizeClasses.medium[size]

  return (
    <svg
      role='button'
      viewBox='0 0 30 28'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      className={cn(`${sizeClasses}`, className)}
      {...res}
    >
      <rect width='30' height='28' fill='current' />
      <path
        d='M9 12H21M9 16H21M15 8V20M12.2 8H17.8C18.9201 8 19.4802 8 19.908 8.21799C20.2843 8.40973 20.5903 8.71569 20.782 9.09202C21 9.51984 21 10.0799 21 11.2V16.8C21 17.9201 21 18.4802 20.782 18.908C20.5903 19.2843 20.2843 19.5903 19.908 19.782C19.4802 20 18.9201 20 17.8 20H12.2C11.0799 20 10.5198 20 10.092 19.782C9.71569 19.5903 9.40973 19.2843 9.21799 18.908C9 18.4802 9 17.9201 9 16.8V11.2C9 10.0799 9 9.51984 9.21799 9.09202C9.40973 8.71569 9.71569 8.40973 10.092 8.21799C10.5198 8 11.0799 8 12.2 8Z'
        stroke={currentVisible ? 'white' : '#C8D0D9'}
        strokeWidth='1.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}
