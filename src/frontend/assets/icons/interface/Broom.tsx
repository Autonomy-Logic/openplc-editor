import { ComponentPropsWithRef } from 'react'

type BroomIconProps = ComponentPropsWithRef<'svg'>

const BroomIcon = (props: BroomIconProps) => (
  <svg
    xmlns='http://www.w3.org/2000/svg'
    xmlSpace='preserve'
    viewBox='0 -1.43 122.88 122.88'
    className='h-4 w-4 fill-gray-500'
    {...props}
  >
    <path
      d='M110.97 1.27 70.02 42.73l10.67 10.36 41.25-41.56c3.64-7.83-4.02-14.38-10.97-10.26zM54.04 46.81c.4-.31.81-.58 1.22-.81l.15-.08c2.35-1.28 4.81-1.24 7.39.53l7.17 6.98.11.11 6.6 6.42c2.73 2.78 3.34 5.88 1.83 9.31l-19.35 50.75C24.02 112.99-.34 87.94 0 49.73c19.23 5.62 37.75 7.46 54.04-2.92z'
      style={{
        fillRule: 'evenodd',
        clipRule: 'evenodd',
      }}
    />
  </svg>
)
export { BroomIcon }
