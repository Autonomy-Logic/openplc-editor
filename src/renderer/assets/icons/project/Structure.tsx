import { cn } from '@utils/cn'
import { ComponentPropsWithoutRef } from 'react'

type StructureIconProps = ComponentPropsWithoutRef<'svg'> & {
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: 'w-5 h-5',
  md: 'w-6 h-6',
  lg: 'w-12 h-12',
}

export const StructureIcon = (props: StructureIconProps) => {
  const { className, size = 'sm', ...res } = props
  return (
    <svg
      viewBox='0 0 28 28'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      className={cn(`${sizeClasses[size]}`, className)}
      {...res}
    >
      <title>Structure Icon</title>
      <path
        opacity='0.4'
        d='M3.49988 20.9997V6.99968C3.49988 4.42235 5.58922 2.33301 8.16655 2.33301L15.1665 2.33302L24.4999 11.6664V20.9997C24.4999 23.577 22.4105 25.6664 19.8332 25.6664H8.16654C5.58922 25.6664 3.49988 23.577 3.49988 20.9997Z'
        fill='#023C97'
      />
      <path
        d='M15.1661 6.99977V2.3331L24.4995 11.6664H19.8328C17.2555 11.6664 15.1661 9.5771 15.1661 6.99977Z'
        fill='#023C97'
      />
      <mask id='mask0_113_22' maskUnits='userSpaceOnUse' x='8' y='11' width='10' height='11'>
        <path d='M18 11.9287H8V21.9287H18V11.9287Z' fill='white' />
      </mask>
      <g mask='url(#mask0_113_22)'>
        <path
          opacity='0.4'
          d='M9.25 15.6787H16.75M11.75 13.1787V20.6787M14.75 20.6787H11.25C10.5499 20.6787 10.1999 20.6787 9.93251 20.5425C9.69731 20.4226 9.50608 20.2314 9.38624 19.9962C9.25 19.7288 9.25 19.3788 9.25 18.6787V15.1787C9.25 14.4787 9.25 14.1286 9.38624 13.8612C9.50608 13.626 9.69731 13.4348 9.93251 13.315C10.1999 13.1787 10.5499 13.1787 11.25 13.1787H14.75C15.4501 13.1787 15.8001 13.1787 16.0675 13.315C16.3027 13.4348 16.4939 13.626 16.6138 13.8612C16.75 14.1286 16.75 14.4787 16.75 15.1787V17.9296'
          stroke='#B4D0FE'
          strokeWidth='0.7'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
      </g>
      <path
        d='M17.0193 19.1291C17.0193 18.9805 16.8988 18.86 16.7501 18.86C16.6015 18.86 16.481 18.9805 16.481 19.1291V19.7622H15.8479C15.6992 19.7622 15.5787 19.8827 15.5787 20.0314C15.5787 20.18 15.6992 20.3006 15.8479 20.3006H16.481V20.9336C16.481 21.0823 16.6015 21.2028 16.7501 21.2028C16.8988 21.2028 17.0193 21.0823 17.0193 20.9336V20.3006H17.6524C17.8011 20.3006 17.9216 20.18 17.9216 20.0314C17.9216 19.8827 17.8011 19.7622 17.6524 19.7622H17.0193V19.1291Z'
        fill='white'
        stroke='white'
        strokeWidth='0.2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}
