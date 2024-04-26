import { cn } from '@utils/cn'
import { ComponentProps } from 'react'

type IRecentIconProps = ComponentProps<'svg'> & {
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: 'w-5 h-5',
  md: 'w-8 h-8',
  lg: 'w-12 h-12',
}
export default function RecentProjectIcon(props: IRecentIconProps) {
  const { className, size = 'sm', ...res } = props
  return (
    <svg
      viewBox='0 0 20 18'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      className={cn(sizeClasses[size], className)}
      {...res}
    >
      <title>Recent Icon</title>
      <path
        d='M20 13.6111V6.80555C20 4.65778 18.2091 2.91667 16 2.91667H13.3333C12.4679 2.91667 11.6257 2.64375 10.9333 2.13889L9.06667 0.777778C8.37428 0.272914 7.53215 0 6.66667 0H4C1.79086 0 0 1.74111 0 3.88889V13.6111C0 15.7589 1.79086 17.5 4 17.5H16C18.2091 17.5 20 15.7589 20 13.6111Z'
        fill='#0464FB'
      />
    </svg>
  )
}
