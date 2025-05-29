import { cn } from '@root/utils'
import { ComponentPropsWithoutRef } from 'react'

const msgClass = {
  default: 'text-[#011432] dark:text-white',
  warning: 'text-yellow-600',
  error: 'text-red-500',
  info: 'text-brand-medium dark:text-brand',
}

type LogComponentProps = ComponentPropsWithoutRef<'p'> & {
  type: 'default' | 'info' | 'warning' | 'error'
  message: string
}

/**
 * A single console message.
 */
const LogComponent = ({ type = 'default', message, ...rest }: LogComponentProps) => {
  return (
    <p className={cn('font-normal', msgClass[type])} {...rest}>
      {message}
    </p>
  )
}

export { LogComponent }
