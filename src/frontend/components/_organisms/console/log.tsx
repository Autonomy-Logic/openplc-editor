import type { StructuredCompileError } from '@root/middleware/shared/ports/types'
import { Copy } from 'lucide-react'
import { ComponentPropsWithoutRef, useCallback, useEffect, useRef, useState } from 'react'

import { cn } from '../../../utils/cn'

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
  /** When set, the bracketed POU prefix on the first line becomes a
   *  click-to-open button that calls {@link onCompileErrorClick}.
   *  Multi-line gcc-style snippet renders as plain pre-wrapped text
   *  underneath. */
  compileError?: StructuredCompileError
  onCompileErrorClick?: (err: StructuredCompileError) => void
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
 * Render a compile-error log line: the first line (the bracketed POU
 * prefix the compiler-module emits, e.g. `[Manual_Override / body
 * line 7]`) becomes a button that fires the passed click handler;
 * the remaining lines stay as the plain gcc-style snippet so users
 * can still read the file:line:col header and the source caret.
 *
 * Falls back to plain rendering when no click handler is supplied —
 * keeps the component usable in test setups and snapshot rendering
 * without forcing a navigator into every consumer.
 */
const CompileErrorMessage = ({
  message,
  searchTerm,
  compileError,
  onCompileErrorClick,
}: {
  message: string
  searchTerm?: string
  compileError: StructuredCompileError
  onCompileErrorClick?: (err: StructuredCompileError) => void
}) => {
  const newlineIdx = message.indexOf('\n')
  const headerText = newlineIdx === -1 ? message : message.slice(0, newlineIdx)
  const restText = newlineIdx === -1 ? '' : message.slice(newlineIdx)

  const handleClick = onCompileErrorClick ? () => onCompileErrorClick(compileError) : undefined

  return (
    <>
      {handleClick ? (
        <button
          type='button'
          onClick={handleClick}
          className='cursor-pointer underline-offset-2 hover:underline focus:outline-none focus-visible:underline'
          title='Open in editor'
        >
          <HighlightedText text={headerText} searchTerm={searchTerm} />
        </button>
      ) : (
        <HighlightedText text={headerText} searchTerm={searchTerm} />
      )}
      {restText && <HighlightedText text={restText} searchTerm={searchTerm} />}
    </>
  )
}

/**
 * A single console log with copy and highlight support.
 */
const LogComponent = ({
  level,
  message,
  tstamp,
  searchTerm,
  compileError,
  onCompileErrorClick,
  ...rest
}: LogComponentProps) => {
  const [copied, setCopied] = useState(false)

  let classForMessage = 'text-[#011432] dark:text-white pl-2'
  if (level && messageClasses[level]) {
    classForMessage = messageClasses[level]
  }

  const fullMessage = level && tstamp ? `[${tstamp}]: ${message}` : message

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  const handleCopy = useCallback(() => {
    navigator.clipboard
      .writeText(fullMessage)
      .then(() => {
        setCopied(true)
        timeoutRef.current = setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {
        setCopied(false)
      })
  }, [fullMessage])

  return (
    <>
      {message && (
        <div className='group flex items-start gap-1'>
          <p className={cn('flex-1 whitespace-pre-wrap break-words font-mono font-normal', classForMessage)} {...rest}>
            {level && tstamp ? (
              <>
                [<HighlightedText text={tstamp} searchTerm={searchTerm} />
                ]:{' '}
                {compileError ? (
                  <CompileErrorMessage
                    message={message}
                    searchTerm={searchTerm}
                    compileError={compileError}
                    onCompileErrorClick={onCompileErrorClick}
                  />
                ) : (
                  <HighlightedText text={message} searchTerm={searchTerm} />
                )}
              </>
            ) : compileError ? (
              <CompileErrorMessage
                message={message}
                searchTerm={searchTerm}
                compileError={compileError}
                onCompileErrorClick={onCompileErrorClick}
              />
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
