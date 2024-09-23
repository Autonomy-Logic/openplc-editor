import { cn } from '@utils/cn'
import { ComponentProps } from 'react'

type IFBDIconProps = ComponentProps<'svg'> & {
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: 'w-5 h-5',
  md: 'w-6 h-6',
  lg: 'w-12 h-12',
}

export const PasteIcon = (props: IFBDIconProps) => {
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
        d='M22.4 15.3143V3.35238C22.4 2.97367 22.0991 2.66667 21.728 2.66667H13.6217C13.5027 2.66667 13.3858 2.63443 13.2831 2.57326L9.11693 0.0934087C9.01415 0.0322343 8.89731 0 8.77833 0H0.672C0.300865 0 0 0.307005 0 0.685715V15.3143C0 15.693 0.300864 16 0.671999 16H21.728C22.0991 16 22.4 15.693 22.4 15.3143Z'
        fill='#0350C9'
      />
    </svg>
  )
}
