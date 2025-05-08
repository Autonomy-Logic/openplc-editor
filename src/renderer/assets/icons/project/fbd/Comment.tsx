import { cn } from '@utils/cn'
import { ComponentPropsWithoutRef } from 'react'

type ICommentIconProps = ComponentPropsWithoutRef<'svg'> & {
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: 'w-5 h-5',
  md: 'w-6 h-6',
  lg: 'w-12 h-12',
}
export default function CommentIcon(props: ICommentIconProps) {
  const { className, size = 'sm', ...res } = props
  return (
    <svg
      className={cn(sizeClasses[size], className)}
      viewBox='0 0 28 28'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      {...res}
    >
      <path
        opacity='0.4'
        d='M6.99999 2.33334H21C23.5773 2.33334 25.6667 4.42268 25.6667 7.00001V21C25.6667 23.5773 23.5773 25.6667 21 25.6667H7C4.42267 25.6667 2.33333 23.5773 2.33333 21V7.00001C2.33333 4.42268 4.42267 2.33334 6.99999 2.33334Z'
        fill='#B4D0FE'
      />
      <path
        d='M21 7.5C21.8284 7.5 22.5 8.17157 22.5 9V17.667C22.4998 18.4953 21.8283 19.167 21 19.167H16.6934C16.5111 19.167 16.3454 19.2656 16.2578 19.4209L16.2246 19.4912L15.4189 21.6387C14.9296 22.9436 13.0813 22.9339 12.6055 21.624L11.832 19.4961C11.7603 19.2986 11.5724 19.1672 11.3623 19.167H7C6.17168 19.167 5.50018 18.4953 5.5 17.667V9C5.5 8.17157 6.17157 7.5 7 7.5H21Z'
        stroke='#B4D0FE'
      />
    </svg>
  )
}
