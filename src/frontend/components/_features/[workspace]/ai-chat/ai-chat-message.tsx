import { useMemo, useState } from 'react'
import Markdown from 'react-markdown'

import type { ChatMessage } from '../../../../../middleware/shared/ports/types'
import { useAI } from '../../../../../middleware/shared/providers'
import { trackChatRating } from '../../../../services/ai/telemetry'
import { useOpenPLCStore } from '../../../../store'
import { AIChatToolSummary } from './ai-chat-tool-summary'
import type { ChatTurn } from './ai-chat-turns'
import { AICodeBlock } from './ai-code-block'

function getMessageText(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content
  return content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type AIChatTurnProps = {
  turn: ChatTurn
  language?: string
  onInsertAtCursor?: (code: string) => void
  onRegenerate?: () => void
}

export const AIChatTurn = ({ turn, language, onInsertAtCursor, onRegenerate }: AIChatTurnProps) => {
  if (turn.kind === 'user') return <UserBubble message={turn.message} />
  return (
    <AssistantBubble turn={turn} language={language} onInsertAtCursor={onInsertAtCursor} onRegenerate={onRegenerate} />
  )
}

const UserBubble = ({ message }: { message: ChatMessage }) => {
  const text = getMessageText(message.content)
  return (
    <div className='flex justify-end'>
      <div className='max-w-[80%] select-text rounded-[14px] rounded-br-[4px] bg-brand px-3 py-2 text-[13px] leading-snug text-white shadow-[0_2px_6px_rgba(4,100,251,0.25)] [overflow-wrap:anywhere]'>
        <p className='whitespace-pre-wrap'>{text}</p>
      </div>
    </div>
  )
}

type AssistantBubbleProps = {
  turn: Extract<ChatTurn, { kind: 'assistant' }>
  language?: string
  onInsertAtCursor?: (code: string) => void
  onRegenerate?: () => void
}

const AssistantBubble = ({ turn, language, onInsertAtCursor, onRegenerate }: AssistantBubbleProps) => {
  const { rateMessage } = useOpenPLCStore.useAiActions()
  const ai = useAI()
  const [copied, setCopied] = useState(false)

  const text = useMemo(() => {
    const texts: string[] = []
    for (const msg of turn.messages) {
      const t = getMessageText(msg.content)
      if (t) texts.push(t)
    }
    return texts.join('\n\n')
  }, [turn.messages])

  // Rating lives on the last message of the turn — the model's final word.
  const ratingTarget = turn.messages[turn.messages.length - 1]

  const handleRate = (rating: 'up' | 'down') => {
    const newRating = ratingTarget.rating === rating ? undefined : rating
    rateMessage(ratingTarget.id, newRating)
    if (newRating && ai) {
      trackChatRating(ai, { messageId: ratingTarget.id, rating: newRating, language: language ?? 'st' })
    }
  }

  const handleCopy = () => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const hasCompletedToolCalls = turn.toolCalls.some((c) => c.status !== 'pending')
  const showActions = !turn.isStreaming && (text || hasCompletedToolCalls)

  return (
    <div className='w-full min-w-0 max-w-full select-text overflow-hidden rounded-xl border border-neutral-200 bg-white px-3.5 py-3 text-[12.5px] leading-[1.55] text-neutral-700 [overflow-wrap:anywhere] dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-200'>
      {turn.isStreaming ? (
        text ? (
          <p className='whitespace-pre-wrap'>
            {text}
            <span className='ai-chat-typing-dot ml-1 align-middle' />
          </p>
        ) : (
          <div className='flex items-center text-neutral-400 dark:text-neutral-500' aria-label='Assistant is typing'>
            <span className='ai-chat-typing-dot' />
            <span className='ai-chat-typing-dot' />
            <span className='ai-chat-typing-dot' />
          </div>
        )
      ) : (
        <div className='space-y-2'>
          <Markdown
            components={{
              code({ className, children }) {
                const match = /language-(\w+)/.exec(className || '')
                const code = String((children as string) ?? '').replace(/\n$/, '')
                if (match) {
                  return <AICodeBlock code={code} language={match[1]} onInsertAtCursor={onInsertAtCursor} />
                }
                return (
                  <code className='whitespace-nowrap rounded border border-neutral-200 bg-neutral-100 px-1.5 py-px font-mono text-[11.5px] text-neutral-700 dark:border-white/10 dark:bg-white/[0.06] dark:text-neutral-200'>
                    {children}
                  </code>
                )
              },
              pre({ children }) {
                return <>{children}</>
              },
              p({ children }) {
                return <p className='leading-[1.55]'>{children}</p>
              },
              ul({ children }) {
                return <ul className='ml-4 list-disc space-y-0.5 text-neutral-500 dark:text-neutral-400'>{children}</ul>
              },
              ol({ children }) {
                return (
                  <ol className='ml-4 list-decimal space-y-0.5 text-neutral-500 dark:text-neutral-400'>{children}</ol>
                )
              },
              li({ children }) {
                return <li className='leading-snug'>{children}</li>
              },
              h1({ children }) {
                return <h3 className='text-[12px] font-semibold text-neutral-900 dark:text-white'>{children}</h3>
              },
              h2({ children }) {
                return <h3 className='text-[12px] font-semibold text-neutral-900 dark:text-white'>{children}</h3>
              },
              h3({ children }) {
                return <h3 className='text-[12px] font-semibold text-neutral-900 dark:text-white'>{children}</h3>
              },
              strong({ children }) {
                return <strong className='font-semibold text-neutral-900 dark:text-white'>{children}</strong>
              },
              blockquote({ children }) {
                return (
                  <blockquote className='border-l-2 border-neutral-300 pl-2 italic dark:border-neutral-600'>
                    {children}
                  </blockquote>
                )
              },
              hr() {
                return <hr className='my-2 border-neutral-200 dark:border-white/5' />
              },
              table({ children }) {
                return (
                  <div className='-mx-1 my-1 overflow-x-auto'>
                    <table className='w-max border-collapse text-[11.5px]'>{children}</table>
                  </div>
                )
              },
              thead({ children }) {
                return <thead className='border-b border-neutral-200 dark:border-white/10'>{children}</thead>
              },
              tbody({ children }) {
                return <tbody>{children}</tbody>
              },
              tr({ children }) {
                return <tr className='border-b border-neutral-100 last:border-0 dark:border-white/5'>{children}</tr>
              },
              th({ children }) {
                return (
                  <th className='whitespace-nowrap px-2 py-1 text-left font-semibold text-neutral-900 dark:text-white'>
                    {children}
                  </th>
                )
              },
              td({ children }) {
                return <td className='px-2 py-1 align-top'>{children}</td>
              },
            }}
          >
            {text}
          </Markdown>
          <AIChatToolSummary toolCalls={turn.toolCalls} />
        </div>
      )}

      {showActions && (
        <div className='mt-2.5 flex items-center gap-1 border-t border-neutral-100 pt-2 dark:border-white/5'>
          <ActionButton title={copied ? 'Copied' : 'Copy'} onClick={handleCopy}>
            {copied ? (
              <svg
                width='13'
                height='13'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='1.75'
                strokeLinecap='round'
                strokeLinejoin='round'
              >
                <path d='m5 12 5 5 9-11' />
              </svg>
            ) : (
              <svg
                width='13'
                height='13'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='1.75'
                strokeLinecap='round'
                strokeLinejoin='round'
              >
                <rect x='9' y='9' width='11' height='11' rx='2' />
                <path d='M5 15V5a2 2 0 0 1 2-2h10' />
              </svg>
            )}
          </ActionButton>
          {onRegenerate && (
            <ActionButton title='Regenerate' onClick={onRegenerate}>
              <svg
                width='13'
                height='13'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                strokeWidth='1.75'
                strokeLinecap='round'
                strokeLinejoin='round'
              >
                <path d='M3 12a9 9 0 0 1 15.5-6.3L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.3L3 16M3 21v-5h5' />
              </svg>
            </ActionButton>
          )}
          <div className='flex-1' />
          <ActionButton title='Good response' active={ratingTarget.rating === 'up'} onClick={() => handleRate('up')}>
            <svg
              width='13'
              height='13'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='1.75'
              strokeLinecap='round'
              strokeLinejoin='round'
            >
              <path d='M7 10v10H4V10h3Zm0 0 5-7c1.5 0 2.5 1 2.5 2.5V9h4.5c1.1 0 1.9 1 1.7 2l-1.3 7c-.2 1-1 1.7-2 1.7H7' />
            </svg>
          </ActionButton>
          <ActionButton title='Bad response' active={ratingTarget.rating === 'down'} onClick={() => handleRate('down')}>
            <svg
              width='13'
              height='13'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='1.75'
              strokeLinecap='round'
              strokeLinejoin='round'
            >
              <path d='M7 14V4H4v10h3Zm0 0 5 7c1.5 0 2.5-1 2.5-2.5V15h4.5c1.1 0 1.9-1 1.7-2l-1.3-7C19.2 4.7 18.4 4 17.4 4H7' />
            </svg>
          </ActionButton>
        </div>
      )}
    </div>
  )
}

function ActionButton({
  children,
  title,
  active,
  onClick,
}: {
  children: React.ReactNode
  title: string
  active?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type='button'
      title={title}
      onClick={onClick}
      className={`grid h-6 w-6 place-items-center rounded transition-colors ${
        active
          ? 'text-brand dark:text-brand-light'
          : 'text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-500 dark:hover:bg-white/[0.06] dark:hover:text-neutral-200'
      }`}
    >
      {children}
    </button>
  )
}
