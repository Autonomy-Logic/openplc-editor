import { cn } from '@root/utils'
import { ComponentPropsWithRef, forwardRef } from 'react'

type IEditButtonIconProps = ComponentPropsWithRef<'svg'> & {
  variant?: 'default' | 'primary' | 'secondary'
  direction?: 'up' | 'down' | 'left' | 'right'
  size?: 'sm' | 'md' | 'lg'
}

const directionClasses = {
  up: 'rotate-0',
  left: 'rotate-90',
  down: 'rotate-180',
  right: 'rotate-270',
}

const variantClasses = {
  default: 'stroke-brand-light',
  primary: 'stroke-brand',
  secondary: 'stroke-brand-medium-dark',
}

const sizeClasses = {
  sm: 'w-3 h-3',
  md: 'w-5 h-5',
  lg: 'w-7 h-7',
}
const EditButton = forwardRef<SVGSVGElement, IEditButtonIconProps>(
  ({ className, variant = 'default', size = 'sm', direction = 'up', ...res }, ref) => {
    return (
      <svg
        className={cn(
          `${variantClasses[variant]}`,
          `${directionClasses[direction]}`,
          `${sizeClasses[size]}`,
          className,
        )}
        viewBox='0 0 1024 1024'
        fill='none'
        xmlns='http://www.w3.org/2000/svg'
        aria-label='Edit Button'
        ref={ref}
        {...res}
      >
        <path
          d='M252.3 743.3l235.8-42.4-147.8-179.1zM365.2 501.4l148.2 178.8L868.3 389 720.2 210.2zM958 259.7l-92.6-111.9c-15.1-18.4-43.7-20.3-63.7-4.2l-53.9 44 148.1 179.1 53.9-44c19.6-16.1 23.3-44.6 8.2-63z'
          fill='#2867CE'
        />
        <path
          d='M770.1 893.7H259.6c-93.1 0-168.5-75.5-168.5-168.5V345.4c0-93.1 75.5-168.5 168.5-168.5h49.6c26.6 0 48.1 21.5 48.1 48.1s-21.5 48.1-48.1 48.1h-49.6c-40 0-72.4 32.4-72.4 72.4v379.8c0 40 32.4 72.4 72.4 72.4h510.5c40 0 72.4-32.4 72.4-72.4v-132c0-26.6 21.5-48.1 48.1-48.1s48.1 21.5 48.1 48.1v132c-0.1 93-75.5 168.4-168.6 168.4z'
          fill='#BDD2EF'
        />
      </svg>
    )
  },
)

export default EditButton
