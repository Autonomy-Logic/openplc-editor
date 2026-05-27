import { ComponentProps } from 'react'

import { cn } from '../../../utils/cn'

type ILibraryIconProps = ComponentProps<'svg'> & {
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: 'w-5 h-5',
  md: 'w-6 h-6',
  lg: 'w-12 h-12',
}

/**
 * Library tab/project icon.  Two-tone book stack matching the project
 * icon family's visual language: a brand-dark outer shell with a
 * white inner glyph (a stylized bookmark) and a subtly translucent
 * second book peeking out the side.
 */
export const LibraryIcon = (props: ILibraryIconProps) => {
  const { className, size = 'sm', ...res } = props
  return (
    <svg
      aria-hidden='true'
      viewBox='0 0 28 28'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      className={cn(`${sizeClasses[size]}`, className)}
      {...res}
    >
      {/* Back book (faded) */}
      <path
        opacity='0.4'
        d='M22 5.5C22 4.39543 21.1046 3.5 20 3.5H8C6.89543 3.5 6 4.39543 6 5.5V23.5C6 24.6046 6.89543 25.5 8 25.5H20C21.1046 25.5 22 24.6046 22 23.5V5.5Z'
        fill='#023C97'
      />
      {/* Front book */}
      <path
        d='M19.3333 2.5H7.66667C6.19391 2.5 5 3.69391 5 5.16667V22.8333C5 24.3061 6.19391 25.5 7.66667 25.5H19.3333C20.8061 25.5 22 24.3061 22 22.8333V5.16667C22 3.69391 20.8061 2.5 19.3333 2.5Z'
        fill='#023C97'
      />
      {/* Bookmark glyph (white inset) */}
      <path d='M11 2.5H16V11L13.5 9L11 11V2.5Z' fill='white' />
      {/* Inner shelf accent */}
      <path
        opacity='0.55'
        d='M8.5 19.5C8.5 19.2239 8.72386 19 9 19H18C18.2761 19 18.5 19.2239 18.5 19.5C18.5 19.7761 18.2761 20 18 20H9C8.72386 20 8.5 19.7761 8.5 19.5Z'
        fill='white'
      />
      <path
        opacity='0.55'
        d='M8.5 21.5C8.5 21.2239 8.72386 21 9 21H16C16.2761 21 16.5 21.2239 16.5 21.5C16.5 21.7761 16.2761 22 16 22H9C8.72386 22 8.5 21.7761 8.5 21.5Z'
        fill='white'
      />
    </svg>
  )
}
