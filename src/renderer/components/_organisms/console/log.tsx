import { cn } from '@root/utils'
import { ComponentPropsWithoutRef } from 'react'

const messageClasses = {
  debug: 'text-neutral-500 dark:text-neutral-400',
  warning: 'text-yellow-600',
  error: 'text-red-500',
  info: 'text-brand-medium dark:text-brand',
}

export type LogLevel = 'debug' | 'info' | 'warning' | 'error'

type LogComponentProps = ComponentPropsWithoutRef<'p'> & {
  level?: LogLevel
  message: string
  tstamp: string
}

/**
 * A single console log.
 */
const LogComponent = ({ level, message, tstamp, ...rest }: LogComponentProps) => {
  let classForMessage = 'text-[#011432] dark:text-white pl-2'
  if (level && messageClasses[level]) {
    classForMessage = messageClasses[level]
  }
  return (
    <>
      {message && (
        <p className={cn('font-normal', classForMessage)} {...rest}>
          {level ? `[${tstamp}]: ${message}` : message}
        </p>
      )}
    </>
  )
}

export { LogComponent }
