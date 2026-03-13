import { useOpenPLCStore } from '../../../../store'
import { trackChatRating } from '../../../../services/ai'
import type { ChatMessage } from '../../../../store/slices/ai/types'
import Markdown from 'react-markdown'
import { AICodeBlock } from './ai-code-block'

type AIMessageProps = {
  message: ChatMessage
  pouName: string
  language?: string
  isStreaming?: boolean
  onInsertAtCursor?: (code: string) => void
}

export const AIChatMessage = ({ message, pouName, language, isStreaming, onInsertAtCursor }: AIMessageProps) => {
  const { rateMessage } = useOpenPLCStore.useAiActions()
  const isUser = message.role === 'user'

  const handleRate = (rating: 'up' | 'down') => {
    const newRating = message.rating === rating ? undefined : rating
    rateMessage(pouName, message.id, newRating)
    if (newRating) {
      trackChatRating({ messageId: message.id, rating: newRating, language: language ?? 'st' })
    }
  }

  return (
    <div className={`flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
      <div
        className={`max-w-[90%] rounded-lg px-3 py-2 text-xs ${
          isUser ? 'bg-brand text-white' : 'bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100'
        }`}
      >
        {isUser || isStreaming ? (
          <p className='whitespace-pre-wrap leading-relaxed'>{message.content}</p>
        ) : (
          <Markdown
            components={{
              code({ className, children }) {
                const match = /language-(\w+)/.exec(className || '')
                const code = String(children).replace(/\n$/, '')
                if (match) {
                  return <AICodeBlock code={code} language={match[1]} onInsertAtCursor={onInsertAtCursor} />
                }
                return (
                  <code className='rounded bg-neutral-200 px-1 py-0.5 font-mono text-[11px] dark:bg-neutral-700'>
                    {children}
                  </code>
                )
              },
              pre({ children }) {
                return <>{children}</>
              },
              p({ children }) {
                return <p className='my-1 leading-relaxed'>{children}</p>
              },
              ul({ children }) {
                return <ul className='my-1 ml-4 list-disc'>{children}</ul>
              },
              ol({ children }) {
                return <ol className='my-1 ml-4 list-decimal'>{children}</ol>
              },
              li({ children }) {
                return <li className='my-0.5'>{children}</li>
              },
              h1({ children }) {
                return <h1 className='my-1 text-sm font-bold'>{children}</h1>
              },
              h2({ children }) {
                return <h2 className='my-1 text-sm font-bold'>{children}</h2>
              },
              h3({ children }) {
                return <h3 className='my-1 font-bold'>{children}</h3>
              },
              strong({ children }) {
                return <strong className='font-semibold'>{children}</strong>
              },
              blockquote({ children }) {
                return (
                  <blockquote className='my-1 border-l-2 border-neutral-300 pl-2 italic dark:border-neutral-600'>
                    {children}
                  </blockquote>
                )
              },
              hr() {
                return <hr className='my-2 border-neutral-300 dark:border-neutral-600' />
              },
            }}
          >
            {message.content}
          </Markdown>
        )}
      </div>

      {!isUser && message.content && (
        <div className='flex items-center gap-1 px-1'>
          <button
            onClick={() => handleRate('up')}
            className={`rounded p-0.5 text-[10px] ${
              message.rating === 'up'
                ? 'text-green-600 dark:text-green-400'
                : 'text-neutral-400 hover:text-green-600 dark:text-neutral-500 dark:hover:text-green-400'
            }`}
            title='Good response'
          >
            <svg
              width='12'
              height='12'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='2'
              strokeLinecap='round'
              strokeLinejoin='round'
            >
              <path d='M7 10v12' />
              <path d='M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z' />
            </svg>
          </button>
          <button
            onClick={() => handleRate('down')}
            className={`rounded p-0.5 text-[10px] ${
              message.rating === 'down'
                ? 'text-red-600 dark:text-red-400'
                : 'text-neutral-400 hover:text-red-600 dark:text-neutral-500 dark:hover:text-red-400'
            }`}
            title='Bad response'
          >
            <svg
              width='12'
              height='12'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='2'
              strokeLinecap='round'
              strokeLinejoin='round'
            >
              <path d='M17 14V2' />
              <path d='M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z' />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}
