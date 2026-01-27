import { cn } from '@root/utils'
import { Copy } from 'lucide-react'
import { ComponentPropsWithoutRef, useCallback, useState } from 'react'

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
  searchTerm?: string
}

/**
 * Highlights matching search terms in the text
 */
const HighlightedText = ({ text, searchTerm }: { text: string; searchTerm?: string }) => {
  if (!searchTerm || !text) {
    return <>{text}</>
  }

  const searchLower = searchTerm.toLowerCase()
  const textLower = text.toLowerCase()
  const parts: React.ReactNode[] = []
  let lastIndex = 0

  let index = textLower.indexOf(searchLower)
  while (index !== -1) {
    // Add non-matching text before
    if (index > lastIndex) {
      parts.push(text.slice(lastIndex, index))
    }
    // Add highlighted match
    parts.push(
      <mark key={index} className='rounded bg-yellow-300 px-0.5 dark:bg-yellow-600 dark:text-white'>
        {text.slice(index, index + searchTerm.length)}
      </mark>,
    )
    lastIndex = index + searchTerm.length
    index = textLower.indexOf(searchLower, lastIndex)
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return <>{parts}</>
}

/**
 * A single console log with copy and highlight support.
 */
const LogComponent = ({ level, message, tstamp, searchTerm, ...rest }: LogComponentProps) => {
  const [copied, setCopied] = useState(false)

  let classForMessage = 'text-[#011432] dark:text-white pl-2'
  if (level && messageClasses[level]) {
    classForMessage = messageClasses[level]
  }

  const fullMessage = level && tstamp ? `[${tstamp}]: ${message}` : message

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(fullMessage).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [fullMessage])

  return (
    <>
      {message && (
        <div className='group flex items-start gap-1'>
          <p className={cn('flex-1 font-normal', classForMessage)} {...rest}>
            {level && tstamp ? (
              <>
                [<HighlightedText text={tstamp} searchTerm={searchTerm} />
                ]: <HighlightedText text={message} searchTerm={searchTerm} />
              </>
            ) : (
              <HighlightedText text={message} searchTerm={searchTerm} />
            )}
          </p>
          <button
            onClick={handleCopy}
            className={cn(
              'flex h-5 w-5 shrink-0 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100',
              copied
                ? 'bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-400'
                : 'hover:bg-neutral-100 dark:hover:bg-neutral-800',
            )}
            title={copied ? 'Copied!' : 'Copy to clipboard'}
          >
            <Copy className='h-3 w-3' />
          </button>
        </div>
      )}
    </>
  )
}

export { LogComponent }
