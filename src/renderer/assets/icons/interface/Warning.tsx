import { cn } from '@utils/cn'
import { ComponentPropsWithRef, ElementType } from 'react'

type IWarningIconProps = ComponentPropsWithRef<'svg'> & {
  variant?: 'default' | 'primary' | 'secondary'
  direction?: 'up' | 'down' | 'left' | 'right'
  size?: 'sm' | 'md' | 'lg'
}

const variantClasses = {
  default: 'stroke-brand-light',
  primary: 'stroke-brand',
  secondary: 'stroke-brand-medium-dark',
}

const sizeClasses = {
  sm: 'w-4 h-4',
  md: 'w-6 h-6',
  lg: 'w-8 h-8',
}

export const WarningIcon: ElementType<IWarningIconProps> = ({
  className,
  variant = 'default',
  size = 'sm',
  ref,
  ...res
}) => {
  return (
    <svg
      width='73'
      height='73'
      viewBox='0 0 73 73'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      aria-label='Arrow Icon'
      className={cn(`${variantClasses[variant]}`, `${sizeClasses[size]}`, className)}
      ref={ref}
      {...res}
    >
      <path
        d='M8.28855 63.875C7.73091 63.875 7.22397 63.7356 6.76772 63.4568C6.31147 63.178 5.95661 62.8104 5.70314 62.3542C5.44966 61.8979 5.31025 61.4036 5.28491 60.8714C5.25956 60.3391 5.39897 59.8194 5.70314 59.3125L33.8386 10.6458C34.1427 10.1389 34.5356 9.75868 35.0172 9.50521C35.4988 9.25174 35.9931 9.125 36.5 9.125C37.007 9.125 37.5012 9.25174 37.9828 9.50521C38.4644 9.75868 38.8573 10.1389 39.1615 10.6458L67.2969 59.3125C67.601 59.8194 67.7405 60.3391 67.7151 60.8714C67.6898 61.4036 67.5504 61.8979 67.2969 62.3542C67.0434 62.8104 66.6885 63.178 66.2323 63.4568C65.776 63.7356 65.2691 63.875 64.7115 63.875H8.28855ZM13.5354 57.7917H59.4646L36.5 18.25L13.5354 57.7917ZM36.5 54.75C37.3618 54.75 38.0842 54.4585 38.6672 53.8755C39.2502 53.2925 39.5417 52.5701 39.5417 51.7083C39.5417 50.8465 39.2502 50.1241 38.6672 49.5411C38.0842 48.9582 37.3618 48.6667 36.5 48.6667C35.6382 48.6667 34.9158 48.9582 34.3328 49.5411C33.7498 50.1241 33.4583 50.8465 33.4583 51.7083C33.4583 52.5701 33.7498 53.2925 34.3328 53.8755C34.9158 54.4585 35.6382 54.75 36.5 54.75ZM36.5 45.625C37.3618 45.625 38.0842 45.3335 38.6672 44.7505C39.2502 44.1675 39.5417 43.4451 39.5417 42.5833V33.4583C39.5417 32.5965 39.2502 31.8741 38.6672 31.2911C38.0842 30.7082 37.3618 30.4167 36.5 30.4167C35.6382 30.4167 34.9158 30.7082 34.3328 31.2911C33.7498 31.8741 33.4583 32.5965 33.4583 33.4583V42.5833C33.4583 43.4451 33.7498 44.1675 34.3328 44.7505C34.9158 45.3335 35.6382 45.625 36.5 45.625Z'
        fill='#0464FB'
        stroke='none'
      />
    </svg>
  )
}
