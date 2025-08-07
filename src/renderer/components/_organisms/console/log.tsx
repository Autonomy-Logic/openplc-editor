import { cn } from '@root/utils'
import { ComponentPropsWithoutRef } from 'react'

const messageClasses = {
  warning: 'text-yellow-600',
  error: 'text-red-500',
  info: 'text-brand-medium dark:text-brand',
}

type LogComponentProps = ComponentPropsWithoutRef<'p'> & {
  level?: 'info' | 'warning' | 'error'
  message: string
}

/**
 * A single console log.
 */
const LogComponent = ({ level, message, ...rest }: LogComponentProps) => {
  let classForMessage = 'text-[#011432] dark:text-white pl-2'
  if (level && messageClasses[level]) {
    classForMessage = messageClasses[level]
  }
  return (
    <>
      {message && (
        <p className={cn('font-normal', classForMessage)} {...rest}>
          {level ? `[${new Date().toLocaleTimeString()}]: ${message}` : message}
        </p>
      )}
    </>
  )
}

export { LogComponent }
