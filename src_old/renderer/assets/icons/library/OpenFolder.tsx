import { cn } from '@utils/cn'
import { ComponentProps } from 'react'

type ILibraryOpenFolderIconProps = ComponentProps<'svg'> & {
  size: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: 'w-5 h-5',
  md: 'w-8 h-8',
  lg: 'w-12 h-12',
}

export const LibraryOpenFolderIcon = (props: ILibraryOpenFolderIconProps) => {
  const { size = 'sm', className, ...res } = props
  return (
    <svg
      viewBox='0 0 28 28'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      className={cn(`${sizeClasses[size]}`, className)}
      {...res}
    >
      <path
        d='M23.3334 9.33333V8.16667C23.3334 6.23367 21.7663 4.66667 19.8334 4.66667H16.5638C15.7844 4.66667 15.0273 4.40652 14.4125 3.92747L13.3153 3.07253C12.7005 2.59348 11.9434 2.33333 11.1641 2.33333H8.16669C6.23369 2.33333 4.66669 3.90034 4.66669 5.83333V9.33333H23.3334Z'
        fill='#0464FB'
      />
      <path
        opacity='0.4'
        d='M23.9464 9.33333H4.0523C2.5668 9.33333 1.45951 10.703 1.77076 12.1556L3.87553 21.9778C4.3366 24.1295 6.2381 25.6667 8.43861 25.6667H19.5601C21.7606 25.6667 23.6621 24.1295 24.1231 21.9778L26.2279 12.1556C26.5392 10.703 25.4319 9.33333 23.9464 9.33333Z'
        fill='#0464FB'
      />
    </svg>
  )
}
