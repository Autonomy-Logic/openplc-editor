import { cn } from '@utils/cn'
import { ComponentProps } from 'react'

type IOpenPLCIconProps = ComponentProps<'svg'>

export const OpenPLCIcon = (props: IOpenPLCIconProps) => {
  const { className, ...rest } = props
  return (
    <svg
      viewBox='0 0 12 12'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      aria-labelledby='openplc-logo-title'
      className={cn('w-6 h-6', className)}
      {...rest}
    >
      <title id='openplc-logo-title'>OpenPLC Logo</title>
      {/* <rect width='12' height='12' rx='1.71429' fill='#0464FB' /> */}
      <path
        d='M4.74903 3.42857L2.14285 6L4.74903 8.57143L5.32239 7.99417L3.73219 6.44024C3.61547 6.32618 3.45921 6.26239 3.29656 6.26239H2.87258V5.73761H3.29656C3.45921 5.73761 3.61547 5.67381 3.73219 5.55976L5.32239 4.00583L4.74903 3.42857Z'
        fill='white'
      />
      <path
        d='M7.25096 3.42857L9.85714 6L7.25096 8.57143L6.6776 7.99417L8.2678 6.44024C8.38452 6.32618 8.54078 6.26239 8.70343 6.26239H9.12741V5.73761H8.70343C8.54078 5.73761 8.38452 5.67381 8.2678 5.55976L6.6776 4.00583L7.25096 3.42857Z'
        fill='white'
      />
    </svg>
  )
}
