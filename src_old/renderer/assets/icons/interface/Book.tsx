import { cn } from '@utils/cn'
import { ComponentProps } from 'react'

type IBookIconProps = ComponentProps<'svg'> & {
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: 'w-5 h-5',
  md: 'w-8 h-8',
  lg: 'w-12 h-12',
}
export const BookIcon = (props: IBookIconProps) => {
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
        opacity='0.4'
        d='M19.8322 2.33337H8.16553C6.23253 2.33337 4.66553 3.90038 4.66553 5.83337V22.1667H23.3322V5.83337C23.3322 3.90038 21.7652 2.33337 19.8322 2.33337Z'
        fill='#0464FB'
      />
      <path d='M10.4988 10.5V2.33337H17.4988V10.5L13.9988 7.93337L10.4988 10.5Z' fill='#0464FB' />
      <path
        d='M4.66553 22.1667C4.66553 20.2337 6.23253 18.6667 8.16553 18.6667H23.3322V22.1667C23.3322 24.0997 21.7652 25.6667 19.8322 25.6667H8.16553C6.23253 25.6667 4.66553 24.0997 4.66553 22.1667Z'
        fill='#0464FB'
      />
    </svg>
  )
}
