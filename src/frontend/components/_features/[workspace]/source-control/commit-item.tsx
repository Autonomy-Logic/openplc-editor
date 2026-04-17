import type { Commit } from '../../../../../middleware/shared/ports/version-control-port'
import { cn } from '../../../../utils/cn'

type CommitItemProps = {
  commit: Commit
  isSelected: boolean
  onClick: () => void
}

function formatRelativeTime(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`
  return `${days} day${days > 1 ? 's' : ''} ago`
}

export function CommitItem({ commit, isSelected, onClick }: CommitItemProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'group w-full rounded-md px-3 py-2 text-left transition-colors duration-150',
        isSelected
          ? 'border border-blue-500/30 bg-blue-500/10 dark:bg-blue-500/20'
          : 'hover:bg-neutral-100 dark:hover:bg-neutral-800',
      )}
    >
      <div className='mb-0.5 flex items-center gap-2'>
        <span className='shrink-0 font-mono text-xs text-blue-500 dark:text-blue-400'>{commit.shortHash}</span>
        <span className='truncate text-xs text-neutral-500 dark:text-neutral-400'>{commit.author}</span>
        <span className='ml-auto shrink-0 text-xs text-neutral-400 dark:text-neutral-500'>
          {formatRelativeTime(commit.timestamp)}
        </span>
      </div>
      <p className='truncate text-xs text-neutral-800 dark:text-neutral-200'>{commit.message}</p>
    </button>
  )
}
