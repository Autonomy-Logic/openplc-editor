import { cn } from '@utils/cn'
import { ComponentProps } from 'react'

type ILibraryFileIconProps = ComponentProps<'svg'> & {
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: 'w-5 h-5',
  md: 'w-8 h-8',
  lg: 'w-12 h-12',
}

export const LibraryFileIcon = (props: ILibraryFileIconProps) => {
  const { className, size = 'sm', ...res } = props
  return (
    <svg
      viewBox='0 0 28 28'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      className={cn(`${sizeClasses[size]} fill-brand-medium-dark dark:fill-brand-light`, className)}
      {...res}
    >
      <path
        opacity='0.4'
        d='M8.16667 25.6667C10.3454 25.6667 12.1754 24.1736 12.6893 22.1549C12.8483 21.5304 13.3557 21 14 21H22.1667V5.83334C22.1667 3.90034 20.5997 2.33334 18.6667 2.33334H7C5.067 2.33334 3.5 3.90034 3.5 5.83334V21C3.5 23.5773 5.58934 25.6667 8.16667 25.6667Z'
        fill='inherit'
      />
      <path
        d='M22.1667 25.6667C24.4248 25.6667 26.3083 24.0628 26.7402 21.9322C26.8432 21.4243 26.4133 21 25.8951 21H22.1667H13.7716C13.2534 21 12.8432 21.4243 12.7402 21.9322C12.3083 24.0628 10.4248 25.6667 8.16666 25.6667H22.1667Z'
        fill='inherit'
      />
      <path
        fillRule='evenodd'
        clipRule='evenodd'
        d='M7.29166 8.16666C7.29166 7.68341 7.68341 7.29166 8.16666 7.29166H17.5C17.9832 7.29166 18.375 7.68341 18.375 8.16666C18.375 8.64991 17.9832 9.04166 17.5 9.04166H8.16666C7.68341 9.04166 7.29166 8.64991 7.29166 8.16666Z'
        fill='inherit'
      />
      <path
        fillRule='evenodd'
        clipRule='evenodd'
        d='M7.29166 14C7.29166 13.5168 7.68341 13.125 8.16666 13.125L12.8333 13.125C13.3166 13.125 13.7083 13.5168 13.7083 14C13.7083 14.4832 13.3166 14.875 12.8333 14.875L8.16666 14.875C7.68341 14.875 7.29166 14.4832 7.29166 14Z'
        fill='inherit'
      />
    </svg>
  )
}
