import { useEffect, useMemo, useState } from 'react'

import type { Branch } from '../../../../../middleware/shared/ports/version-control-port'
import { useVersionControl } from '../../../../../middleware/shared/providers'
import { cn } from '../../../../utils/cn'

type BranchSwitcherModalProps = {
  isOpen: boolean
  projectId: string
  currentBranchName: string
  onClose: () => void
  onSelect: (branch: Branch) => void
  onCreateNew: () => void
  onDelete: (branch: Branch) => void
}

export function BranchSwitcherModal({
  isOpen,
  projectId,
  currentBranchName,
  onClose,
  onSelect,
  onCreateNew,
  onDelete,
}: BranchSwitcherModalProps) {
  const versionControl = useVersionControl()
  const [branches, setBranches] = useState<Branch[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    if (!isOpen || !versionControl) return
    setFilter('')
    setIsLoading(true)
    versionControl
      .listBranches(projectId)
      .then(({ branches: b }) => setBranches(b))
      .catch(() => setBranches([]))
      .finally(() => setIsLoading(false))
  }, [isOpen, projectId, versionControl])

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  const filtered = useMemo(() => {
    if (!filter.trim()) return branches
    const lower = filter.toLowerCase()
    return branches.filter((b) => b.name.toLowerCase().includes(lower))
  }, [branches, filter])

  if (!isOpen) return null

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center'>
      <div className='absolute inset-0 bg-black/40' onClick={onClose} />
      <div className='relative w-80 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900'>
        {/* Search */}
        <div className='border-b border-neutral-200 p-3 dark:border-neutral-700'>
          <input
            type='text'
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder='Search branches...'
            autoFocus
            className='w-full rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-900 placeholder-neutral-400 outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder-neutral-500'
          />
        </div>

        {/* Branch list */}
        <div className='max-h-56 overflow-y-auto py-1'>
          {isLoading && (
            <p className='px-4 py-3 text-center text-xs text-neutral-500 dark:text-neutral-400'>Loading...</p>
          )}

          {!isLoading && filtered.length === 0 && (
            <p className='px-4 py-3 text-center text-xs text-neutral-500 dark:text-neutral-400'>No branches found</p>
          )}

          {filtered.map((branch) => {
            const isActive = branch.name === currentBranchName
            return (
              <div
                key={branch.id}
                className={cn(
                  'group flex cursor-pointer items-center gap-2 px-4 py-2 text-xs transition-colors',
                  'hover:bg-neutral-100 dark:hover:bg-neutral-800',
                  isActive && 'bg-neutral-100 dark:bg-neutral-800',
                )}
                onClick={() => {
                  onSelect(branch)
                  onClose()
                }}
              >
                <svg className='h-3.5 w-3.5 shrink-0 text-neutral-500' viewBox='0 0 16 16' fill='currentColor'>
                  <path d='M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.5 2.5 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z' />
                </svg>
                <span className='flex-1 truncate font-mono'>{branch.name}</span>
                {isActive && (
                  <svg className='h-3.5 w-3.5 shrink-0 text-green-500' viewBox='0 0 16 16' fill='currentColor'>
                    <path d='M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z' />
                  </svg>
                )}
                {branch.isDefault && (
                  <span className='shrink-0 rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500 dark:bg-neutral-800'>
                    default
                  </span>
                )}
                {!branch.isDefault && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onDelete(branch)
                    }}
                    className='shrink-0 opacity-0 transition-opacity group-hover:opacity-100'
                    title={`Delete ${branch.name}`}
                  >
                    <svg
                      className='h-3.5 w-3.5 text-red-500 hover:text-red-400'
                      viewBox='0 0 16 16'
                      fill='currentColor'
                    >
                      <path d='M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25ZM4.005 5.073a.75.75 0 0 1 .673.627l.79 5.532a.75.75 0 0 0 .742.643h3.58a.75.75 0 0 0 .742-.643l.79-5.532a.75.75 0 0 1 1.49.214l-.79 5.532A2.25 2.25 0 0 1 9.79 13.5H6.21a2.25 2.25 0 0 1-2.23-1.928l-.79-5.532a.75.75 0 0 1 .626-.867Z' />
                    </svg>
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {/* Create new branch */}
        <div className='border-t border-neutral-200 p-2 dark:border-neutral-700'>
          <button
            onClick={() => {
              onClose()
              onCreateNew()
            }}
            className='flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800'
          >
            <svg className='h-3.5 w-3.5' viewBox='0 0 16 16' fill='currentColor'>
              <path d='M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z' />
            </svg>
            Create new branch
          </button>
        </div>
      </div>
    </div>
  )
}
