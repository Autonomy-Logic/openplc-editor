import { cn } from '@root/utils'
import { ComponentPropsWithoutRef } from 'react'
type IContactIconProps = ComponentPropsWithoutRef<'svg'> & {
  size?: 'sm' | 'md' | 'lg'
}
const sizeClasses = {
  sm: 'w-5 h-5',
  md: 'w-6 h-6',
  lg: 'w-12 h-12',
}

export default function ContactIcon(props: IContactIconProps) {
  const { className, size = 'sm', ...res } = props

  return (
    <svg
      className={cn(sizeClasses[size], className)}
      viewBox='0 0 24 24'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      {...res}
    >
      <path
        opacity='0.4'
        d='M5.00065 0.333984H19.0007C21.578 0.333984 23.6673 2.42332 23.6673 5.00065V19.0007C23.6673 21.578 21.578 23.6673 19.0007 23.6673H5.00065C2.42332 23.6673 0.333984 21.578 0.333984 19.0007V5.00065C0.333984 2.42332 2.42332 0.333984 5.00065 0.333984Z'
        fill='#B4D0FE'
      />
      <path d='M15.6992 12H20.6992' stroke='#B4D0FE' strokeWidth='1.5' />
      <path d='M3.69922 12H8.69922' stroke='#B4D0FE' strokeWidth='1.5' />
      <line x1='9.44922' y1='7' x2='9.44922' y2='17' stroke='#B4D0FE' strokeWidth='1.5' />
      <line x1='15.4492' y1='7' x2='15.4492' y2='17' stroke='#B4D0FE' strokeWidth='1.5' />
    </svg>
  )
}
