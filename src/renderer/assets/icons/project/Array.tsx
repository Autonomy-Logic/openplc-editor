import { cn } from '@utils/cn'
import { ComponentPropsWithoutRef } from 'react'

type ArrayIconProps = ComponentPropsWithoutRef<'svg'> & {
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: 'w-5 h-5',
  md: 'w-6 h-6',
  lg: 'w-12 h-12',
}

export const ArrayIcon = (props: ArrayIconProps) => {
  const { className, size = 'sm', ...res } = props
  return (
    <svg
      viewBox='0 0 28 28'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      className={cn(`${sizeClasses[size]}`, className)}
      {...res}
    >
      <title>Array Icon</title>
      <path
        opacity='0.4'
        d='M3.49988 20.9997V6.99968C3.49988 4.42235 5.58922 2.33301 8.16655 2.33301L15.1665 2.33302L24.4999 11.6664V20.9997C24.4999 23.577 22.4105 25.6664 19.8332 25.6664H8.16654C5.58922 25.6664 3.49988 23.577 3.49988 20.9997Z'
        fill='#023C97'
      />
      <path
        d='M15.1661 6.99977V2.3331L24.4995 11.6664H19.8328C17.2555 11.6664 15.1661 9.5771 15.1661 6.99977Z'
        fill='#023C97'
      />
      <path
        d='M12.1501 18.2652H13.8497'
        stroke='white'
        strokeWidth='0.533262'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M14.4868 17.6273V15.9277'
        stroke='white'
        strokeWidth='0.533262'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        fillRule='evenodd'
        clipRule='evenodd'
        d='M13.8496 15.503V15.0782C13.8496 14.8435 14.0398 14.6533 14.2745 14.6533H14.6993C14.934 14.6533 15.1242 14.8435 15.1242 15.0782V15.503C15.1242 15.7377 14.934 15.9279 14.6993 15.9279H14.2745C14.0398 15.9279 13.8496 15.7377 13.8496 15.503Z'
        stroke='white'
        strokeWidth='0.533262'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        fillRule='evenodd'
        clipRule='evenodd'
        d='M15.1242 18.0528V18.4776C15.1242 18.7123 14.934 18.9025 14.6993 18.9025H14.2745C14.0398 18.9025 13.8496 18.7123 13.8496 18.4776V18.0528C13.8496 17.8181 14.0398 17.6279 14.2745 17.6279H14.6993C14.934 17.6279 15.1242 17.8181 15.1242 18.0528Z'
        stroke='white'
        strokeWidth='0.533262'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M13.8497 15.291H12.1501'
        stroke='white'
        strokeWidth='0.533262'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M11.5127 17.6273V15.9277'
        stroke='white'
        strokeWidth='0.533262'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        fillRule='evenodd'
        clipRule='evenodd'
        d='M10.8755 15.503V15.0782C10.8755 14.8435 11.0657 14.6533 11.3003 14.6533H11.7252C11.9598 14.6533 12.1501 14.8435 12.1501 15.0782V15.503C12.1501 15.7377 11.9598 15.9279 11.7252 15.9279H11.3003C11.0657 15.9279 10.8755 15.7377 10.8755 15.503Z'
        stroke='white'
        strokeWidth='0.533262'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        fillRule='evenodd'
        clipRule='evenodd'
        d='M12.1501 18.0528V18.4776C12.1501 18.7123 11.9598 18.9025 11.7252 18.9025H11.3003C11.0657 18.9025 10.8755 18.7123 10.8755 18.4776V18.0528C10.8755 17.8181 11.0657 17.6279 11.3003 17.6279H11.7252C11.9598 17.6279 12.1501 17.8181 12.1501 18.0528Z'
        stroke='white'
        strokeWidth='0.533262'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        opacity='0.4'
        d='M14.7001 12.9541H11.2994C10.1267 12.9541 9.17603 13.9048 9.17603 15.0775V18.4782C9.17603 19.6509 10.1267 20.6016 11.2994 20.6016H14.7001C15.8728 20.6016 16.8235 19.6509 16.8235 18.4782V15.0775C16.8235 13.9048 15.8728 12.9541 14.7001 12.9541Z'
        stroke='#B4D0FE'
        strokeWidth='0.637024'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}
