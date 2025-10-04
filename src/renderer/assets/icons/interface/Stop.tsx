import { IIconProps } from '../Types/iconTypes'

export const StopIcon = (props: IIconProps) => {
  const { className, fill, size = 'sm', ...res } = props

  const sizeMap = {
    xs: 'h-3 w-3',
    sm: 'h-4 w-4',
    md: 'h-5 w-5',
    lg: 'h-6 w-6',
    xl: 'h-7 w-7',
  }
  const sizeClasses = sizeMap[size]

  return (
    <svg
      className={`${sizeClasses} ${className || ''}`}
      viewBox='0 0 24 24'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      {...res}
    >
      <rect x='6' y='6' width='12' height='12' fill={fill || 'currentColor'} />
    </svg>
  )
}
