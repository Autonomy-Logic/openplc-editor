import { ComponentProps } from 'react'

import { cn } from '../../../utils/cn'
type IDocumentationIconProps = ComponentProps<'svg'> & {
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: 'w-5 h-5',
  md: 'w-8 h-8',
  lg: 'w-12 h-12',
}
export const DocumentationIcon = (props: IDocumentationIconProps) => {
  const { className, size = 'sm', ...res } = props
  return (
    <svg
      role='menuitem'
      viewBox='0 0 28 28'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      className={cn(`${sizeClasses[size]}`, className)}
      {...res}
    >
      {/* Page body, with the top-right corner folded over. Two tones like the Folder icon. */}
      <path
        d='M7.58333 2.33333C5.48941 2.33333 3.79167 4.03108 3.79167 6.125V21.875C3.79167 23.9689 5.48941 25.6667 7.58333 25.6667H20.4167C22.5106 25.6667 24.2083 23.9689 24.2083 21.875V10.5H18.375C16.7642 10.5 15.4583 9.19417 15.4583 7.58333V2.33333H7.58333Z'
        fill='#0464FB'
      />
      <path
        opacity='0.4'
        d='M17.2083 2.86877V7.58335C17.2083 8.22768 17.7307 8.75002 18.375 8.75002H23.0896C22.9012 8.36467 22.6447 8.01147 22.3286 7.70941L18.2489 3.81003C17.9375 3.51245 17.5851 3.27247 17.2083 3.09502V2.86877Z'
        fill='#0464FB'
      />
      <path
        opacity='0.4'
        d='M8.75 14.875C8.75 14.3918 9.14175 14 9.625 14H18.375C18.8582 14 19.25 14.3918 19.25 14.875C19.25 15.3582 18.8582 15.75 18.375 15.75H9.625C9.14175 15.75 8.75 15.3582 8.75 14.875ZM8.75 19.25C8.75 18.7668 9.14175 18.375 9.625 18.375H15.75C16.2332 18.375 16.625 18.7668 16.625 19.25C16.625 19.7332 16.2332 20.125 15.75 20.125H9.625C9.14175 20.125 8.75 19.7332 8.75 19.25Z'
        fill='white'
      />
    </svg>
  )
}
