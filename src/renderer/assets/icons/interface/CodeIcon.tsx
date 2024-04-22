import { IconStyles } from '@process:renderer/data/constants/icon-styles'
import { cn } from '@utils/cn'
import React, { ComponentProps } from 'react'

import { IIconProps } from '../Types/iconTypes'

type IProps = ComponentProps<'svg'> & {
  size?: 'sm' | 'md' | 'lg'
  currentVisible?: boolean
}

export const CodeIcon = (props: IProps) => {
  const { currentVisible, className, size = 'sm', ...res } = props
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
      <rect width='30' height='28' fill='inherit' />
      <path
        d='M18.3333 17.3333L21.6667 14L18.3333 10.6667M11.6667 10.6667L8.33333 14L11.6667 17.3333M16.3333 8L13.6667 20'
        stroke={currentVisible ? 'white' : '#C8D0D9'}
        strokeWidth='1.5'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}
