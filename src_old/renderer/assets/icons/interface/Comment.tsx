import { cn } from '@root/utils'
import { ComponentPropsWithoutRef } from 'react'

const CommentIcon = (props: ComponentPropsWithoutRef<'svg'>) => {
  const { className, ...rest } = props
  return (
    <svg className={cn(className)} viewBox='0 0 28 28' fill='none' xmlns='http://www.w3.org/2000/svg' {...rest}>
      <title>Comment Icon</title>
      <path
        opacity='0.4'
        d='M12.8335 4.66681H15.1668C20.9658 4.66681 25.6668 9.36782 25.6668 15.1668V21.0001C25.6668 23.5775 23.5775 25.6668 21.0001 25.6668H12.8335C7.0345 25.6668 2.3335 20.9658 2.3335 15.1668C2.3335 9.36782 7.0345 4.66681 12.8335 4.66681Z'
        fill='#0464FB'
      />
      <path
        fillRule='evenodd'
        clipRule='evenodd'
        d='M8.4585 12.8335C8.4585 12.3502 8.85025 11.9585 9.3335 11.9585H14.0002C14.4834 11.9585 14.8752 12.3502 14.8752 12.8335C14.8752 13.3167 14.4834 13.7085 14.0002 13.7085H9.3335C8.85025 13.7085 8.4585 13.3167 8.4585 12.8335ZM8.4585 17.5002C8.4585 17.0169 8.85025 16.6252 9.3335 16.6252H18.6669C19.1501 16.6252 19.5419 17.0169 19.5419 17.5002C19.5419 17.9834 19.1501 18.3752 18.6669 18.3752H9.3335C8.85025 18.3752 8.4585 17.9834 8.4585 17.5002Z'
        fill='#0464FB'
      />
    </svg>
  )
}

export { CommentIcon }
