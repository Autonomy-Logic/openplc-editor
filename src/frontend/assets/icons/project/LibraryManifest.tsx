import { ComponentProps } from 'react'

import { cn } from '../../../utils/cn'

type ILibraryManifestIconProps = ComponentProps<'svg'> & {
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: 'w-5 h-5',
  md: 'w-6 h-6',
  lg: 'w-12 h-12',
}

/**
 * Library Manifest icon — a document silhouette with the same
 * bookmark glyph the `Library` icon carries, so the eye reads it as
 * "manifest for a library" at first glance.  Matches the project
 * icon family's two-tone style: brand-dark outer shell, white inner
 * glyph, optional opacity for layered depth.
 */
export const LibraryManifestIcon = (props: ILibraryManifestIconProps) => {
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
      {/* Document body — page with folded top-right corner. */}
      <path
        d='M7 3.5C7 2.94772 7.44772 2.5 8 2.5H17L22 7.5V23.5C22 24.6046 21.1046 25.5 20 25.5H8C6.89543 25.5 6 24.6046 6 23.5V5.5C6 4.39543 6.10457 3.5 7 3.5Z'
        fill='#023C97'
      />
      {/* Folded corner highlight (lighter tone) */}
      <path opacity='0.5' d='M17 2.5V6.5C17 7.05228 17.4477 7.5 18 7.5H22L17 2.5Z' fill='white' />
      {/* Library bookmark glyph — same triangular bookmark
          the Library icon uses, anchored at the top of the page so
          the manifest reads as "a library's identity card". */}
      <path d='M10 2.5H15V11L12.5 9L10 11V2.5Z' fill='white' />
      {/* Manifest text lines — two short rules near the bottom of
          the page, matching the depth/opacity of the Library icon's
          shelf accents so the family stays visually coherent. */}
      <path
        opacity='0.55'
        d='M9 19.5C9 19.2239 9.22386 19 9.5 19H18.5C18.7761 19 19 19.2239 19 19.5C19 19.7761 18.7761 20 18.5 20H9.5C9.22386 20 9 19.7761 9 19.5Z'
        fill='white'
      />
      <path
        opacity='0.55'
        d='M9 21.75C9 21.4739 9.22386 21.25 9.5 21.25H16.5C16.7761 21.25 17 21.4739 17 21.75C17 22.0261 16.7761 22.25 16.5 22.25H9.5C9.22386 22.25 9 22.0261 9 21.75Z'
        fill='white'
      />
    </svg>
  )
}
