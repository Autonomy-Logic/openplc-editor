import * as Popover from '@radix-ui/react-popover'
import { useState } from 'react'

import {
  type ConversationSummary,
  useConversations,
  useDeleteConversation,
  useRenameConversation,
} from '../../../../services/ai/conversations'

type Props = {
  projectId: string | null | undefined
  currentConversationId: string | null
  /** Called with the conversation id the user picked to load. */
  onSelect: (id: string) => void
  /** Called when the user picks "+ New chat". */
  onNewChat: () => void
}

/** Format an ISO timestamp as a short relative time (e.g. "5m ago", "Apr 30"). */
function formatRelative(iso: string): string {
  const date = new Date(iso)
  const diffMs = Date.now() - date.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `${diffH}h ago`
  const diffD = Math.floor(diffH / 24)
  if (diffD < 7) return `${diffD}d ago`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export const AIConversationList = ({ projectId, currentConversationId, onSelect, onNewChat }: Props) => {
  const [open, setOpen] = useState(false)
  const { data: conversations, isLoading } = useConversations(projectId)
  const renameMutation = useRenameConversation(projectId)
  const deleteMutation = useDeleteConversation(projectId)

  const handleNewChat = () => {
    onNewChat()
    setOpen(false)
  }

  const handleSelect = (id: string) => {
    onSelect(id)
    setOpen(false)
  }

  const handleRename = (conversation: ConversationSummary) => {
    const next = window.prompt('Rename conversation', conversation.title)
    if (next === null) return
    const trimmed = next.trim()
    if (!trimmed || trimmed === conversation.title) return
    renameMutation.mutate({ id: conversation.id, title: trimmed.slice(0, 200) })
  }

  const handleDelete = (conversation: ConversationSummary) => {
    if (!window.confirm(`Delete "${conversation.title}"? This cannot be undone.`)) return
    deleteMutation.mutate(conversation.id)
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label='Conversation history'
        title='Conversation history'
        className='grid h-[26px] w-[26px] place-items-center rounded text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-white/[0.06] dark:hover:text-white'
      >
        <svg
          width='15'
          height='15'
          viewBox='0 0 24 24'
          fill='none'
          stroke='currentColor'
          strokeWidth='1.75'
          strokeLinecap='round'
          strokeLinejoin='round'
        >
          <path d='M3 6h18M3 12h18M3 18h12' />
        </svg>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={6}
          align='end'
          className='z-50 w-72 rounded-lg border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-700 dark:bg-neutral-900'
        >
          <button
            type='button'
            onClick={handleNewChat}
            className='flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] font-medium text-neutral-800 transition-colors hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-white/[0.06]'
          >
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
              <path d='M12 5v14M5 12h14' />
            </svg>
            New chat
          </button>

          <div className='my-1 border-t border-neutral-100 dark:border-white/5' />

          <div className='mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500'>
            Recent
          </div>

          {isLoading ? (
            <div className='px-2 py-1.5 text-[11px] text-neutral-500 dark:text-neutral-400'>Loading…</div>
          ) : !conversations || conversations.length === 0 ? (
            <div className='px-2 py-1.5 text-[11px] text-neutral-500 dark:text-neutral-400'>
              No conversations yet for this project.
            </div>
          ) : (
            <ul className='max-h-72 overflow-y-auto'>
              {conversations.map((c) => {
                const isActive = c.id === currentConversationId
                return (
                  <li key={c.id} className='group relative'>
                    <button
                      type='button'
                      onClick={() => handleSelect(c.id)}
                      className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                        isActive
                          ? 'bg-brand/10 dark:bg-brand/15 text-brand dark:text-brand-light'
                          : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-white/[0.06]'
                      }`}
                    >
                      <div className='min-w-0 flex-1'>
                        <div className='truncate text-[12px] font-medium leading-tight'>{c.title}</div>
                        <div className='mt-0.5 text-[10px] text-neutral-400 dark:text-neutral-500'>
                          {formatRelative(c.updatedAt)}
                        </div>
                      </div>
                    </button>
                    <div className='absolute right-1 top-1 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100'>
                      <RowAction
                        title='Rename'
                        onClick={(e) => {
                          e.stopPropagation()
                          handleRename(c)
                        }}
                      >
                        <svg
                          width='11'
                          height='11'
                          viewBox='0 0 24 24'
                          fill='none'
                          stroke='currentColor'
                          strokeWidth='2'
                          strokeLinecap='round'
                          strokeLinejoin='round'
                        >
                          <path d='M11 4H4v16h16v-7' />
                          <path d='M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5Z' />
                        </svg>
                      </RowAction>
                      <RowAction
                        title='Delete'
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDelete(c)
                        }}
                      >
                        <svg
                          width='11'
                          height='11'
                          viewBox='0 0 24 24'
                          fill='none'
                          stroke='currentColor'
                          strokeWidth='2'
                          strokeLinecap='round'
                          strokeLinejoin='round'
                        >
                          <path d='M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' />
                        </svg>
                      </RowAction>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function RowAction({
  children,
  title,
  onClick,
}: {
  children: React.ReactNode
  title: string
  onClick: (e: React.MouseEvent) => void
}) {
  return (
    <button
      type='button'
      title={title}
      onClick={onClick}
      className='grid h-5 w-5 place-items-center rounded text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:text-neutral-500 dark:hover:bg-white/[0.08] dark:hover:text-neutral-200'
    >
      {children}
    </button>
  )
}
