import { cn } from '@root/utils'
import { ComponentPropsWithoutRef } from 'react'

type ProhibitedProps = ComponentPropsWithoutRef<'svg'>

export const ProhibitedIcon = (props: ProhibitedProps) => {
  const { className, ...res } = props

  return (
    <svg
      version='1.1'
      xmlns='http://www.w3.org/2000/svg'
      viewBox='0 0 51.976 51.976'
      className={cn('h-5 w-5', className)}
      {...res}
    >
      <path
        d='M44.373,7.603c-10.137-10.137-26.633-10.137-36.77,0c-10.138,10.138-10.138,26.632,0,36.77
	c5.068,5.068,11.727,7.604,18.385,7.604s13.316-2.535,18.385-7.604C54.51,34.235,54.51,17.74,44.373,7.603z M9.017,9.017
	c4.679-4.679,10.825-7.019,16.971-7.019c5.832,0,11.649,2.134,16.228,6.347l-33.87,33.87C-0.307,32.812-0.101,18.135,9.017,9.017z
	 M42.959,42.958c-9.119,9.119-23.795,9.325-33.199,0.671L43.63,9.76C52.284,19.163,52.078,33.84,42.959,42.958z'
        fill='#B4D0FE'
      />
    </svg>
  )
}
