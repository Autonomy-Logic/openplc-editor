import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { Branch } from '../../../../../middleware/shared/ports/version-control-port'
import { useVersionControl } from '../../../../../middleware/shared/providers'
import { cn } from '../../../../utils/cn'
import { CreateBranchPopover } from './create-branch-popover'

type BranchSwitcherPopoverProps = {
  isOpen: boolean
  projectId: string
  currentBranchName: string
  anchorRef?: React.RefObject<HTMLButtonElement | null>
  onClose: () => void
  onSelect: (branch: Branch) => void
  onDelete: (branch: Branch) => void
  onMerge: (branch: Branch) => void
}

export function BranchSwitcherPopover({
  isOpen,
  projectId,
  currentBranchName,
  anchorRef,
  onClose,
  onSelect,
  onDelete,
  onMerge,
}: BranchSwitcherPopoverProps) {
  const versionControl = useVersionControl()
  const [branches, setBranches] = useState<Branch[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [filter, setFilter] = useState('')
  const popoverRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number; bottom: number } | null>(null)
  const [visible, setVisible] = useState(false)
  const [closing, setClosing] = useState(false)

  // Fetch branches each time the popover opens
  useEffect(() => {
    if (!isOpen || !versionControl) return
    setIsLoading(true)
    versionControl
      .listBranches(projectId)
      .then(({ branches: b }) => setBranches(b))
      .catch(() => setBranches([]))
      .finally(() => setIsLoading(false))
  }, [isOpen, projectId, versionControl])

  const handleClose = useCallback(() => {
    setClosing(true)
    setTimeout(() => {
      setClosing(false)
      setVisible(false)
      onClose()
    }, 75) // matches popover-out duration
  }, [onClose])

  useEffect(() => {
    if (isOpen) {
      setFilter('')
      setVisible(true)
      setClosing(false)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || !anchorRef?.current) return
    const rect = anchorRef.current.getBoundingClientRect()
    setPosition({
      left: rect.left,
      bottom: window.innerHeight - rect.top + 4,
    })
  }, [isOpen, anchorRef])

  useEffect(() => {
    if (!visible) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      // Don't close if the click is inside Radix-portalled content (popover form
      // for create branch, or the branch actions dropdown menu)
      if (target.closest?.('[data-radix-popper-content-wrapper]')) return
      if (target.closest?.('[data-radix-menu-content]')) return
      if (popoverRef.current && !popoverRef.current.contains(target)) {
        handleClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [visible, handleClose])

  const filtered = useMemo(() => {
    if (!filter.trim()) return branches
    const lower = filter.toLowerCase()
    return branches.filter((b) => b.name.toLowerCase().includes(lower))
  }, [branches, filter])

  if (!visible) return null

  return (
    <div className='fixed inset-0 z-50'>
      <div
        ref={popoverRef}
        className={cn(
          'box absolute w-72 origin-bottom-left overflow-hidden rounded-lg bg-white dark:bg-neutral-950',
          closing ? 'animate-popover-out' : 'animate-popover-in',
        )}
        style={position ? { left: position.left, bottom: position.bottom } : { left: 8, bottom: 32 }}
      >
        {/* Search */}
        <div className='p-2 pb-0'>
          <input
            type='text'
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder='Search branches...'
            autoFocus
            className='h-[30px] w-full rounded-md border border-neutral-100 bg-white px-2 py-2 text-cp-sm font-medium text-neutral-850 outline-none dark:border-brand-medium-dark dark:bg-neutral-950 dark:text-neutral-300'
          />
          <div className='mt-2 h-[1px] w-full bg-neutral-200 dark:!bg-neutral-850' />
        </div>

        {/* Branch list */}
        <div className='max-h-56 overflow-y-auto px-2 py-1'>
          {isLoading && (
            <p className='px-2 py-3 text-center font-caption text-xs font-normal text-neutral-500 dark:text-neutral-400'>
              Loading...
            </p>
          )}

          {!isLoading && filtered.length === 0 && (
            <p className='px-2 py-3 text-center font-caption text-xs font-normal text-neutral-500 dark:text-neutral-400'>
              No branches found
            </p>
          )}

          {filtered.map((branch) => {
            const isActive = branch.name === currentBranchName
            return (
              <div
                key={branch.id}
                className={cn(
                  'group flex h-7 items-center gap-[6px] rounded-md px-[6px] py-[2px] font-caption text-xs font-normal transition-colors',
                  'hover:bg-neutral-100 dark:hover:bg-neutral-900',
                  isActive && 'bg-neutral-100 dark:bg-neutral-900',
                )}
              >
                {/* Clickable area — only branch icon + name triggers selection.
                    Side elements (checkmark, default badge, dots menu) are OUTSIDE
                    this button so they don't accidentally trigger a branch switch. */}
                <button
                  type='button'
                  onClick={() => {
                    onSelect(branch)
                    handleClose()
                  }}
                  className='flex min-w-0 flex-1 cursor-pointer items-center gap-[6px] bg-transparent text-left'
                >
                  {/* Git branch icon */}
                  <svg
                    className='h-3.5 w-3.5 shrink-0 text-neutral-500 dark:text-neutral-400'
                    viewBox='0 0 16 16'
                    fill='currentColor'
                  >
                    <path d='M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.5 2.5 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z' />
                  </svg>
                  <span className='flex-1 truncate font-mono text-neutral-1000 dark:text-neutral-300'>
                    {branch.name}
                  </span>
                </button>
                {isActive && (
                  <svg className='h-3.5 w-3.5 shrink-0 text-green-500' viewBox='0 0 16 16' fill='currentColor'>
                    <path d='M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z' />
                  </svg>
                )}
                {branch.isDefault && (
                  <span className='shrink-0 rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400'>
                    default
                  </span>
                )}
                {/* Actions menu (3 dots) — reveals merge + delete on hover. */}
                <div className='shrink-0' data-branch-actions>
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger asChild>
                      <button
                        className='rounded p-0.5 opacity-0 transition-opacity hover:bg-neutral-200 group-hover:opacity-100 dark:hover:bg-neutral-800'
                        title='More actions'
                      >
                        <svg
                          className='h-3.5 w-3.5 text-neutral-500 dark:text-neutral-400'
                          viewBox='0 0 16 16'
                          fill='currentColor'
                        >
                          <path d='M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM1.5 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm13 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z' />
                        </svg>
                      </button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content
                        side='right'
                        align='start'
                        sideOffset={4}
                        onCloseAutoFocus={(e) => e.preventDefault()}
                        className='z-[60] min-w-[140px] overflow-hidden rounded-md border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900'
                      >
                        <DropdownMenu.Item
                          disabled={isActive}
                          onSelect={(e) => {
                            e.preventDefault()
                            if (isActive) return
                            onMerge(branch)
                            handleClose()
                          }}
                          title={isActive ? 'Cannot merge a branch into itself' : undefined}
                          className={cn(
                            'flex select-none items-center gap-2 px-3 py-1.5 text-xs outline-none',
                            isActive
                              ? 'cursor-not-allowed text-neutral-400 dark:text-neutral-600'
                              : 'cursor-pointer text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800',
                          )}
                        >
                          <svg
                            className={cn(
                              'h-3.5 w-3.5',
                              isActive ? 'text-neutral-400 dark:text-neutral-600' : 'text-blue-500',
                            )}
                            viewBox='0 0 16 16'
                            fill='currentColor'
                          >
                            <path d='M5 3.254V3.25v.005a.75.75 0 1 1 0-.005v.004zm.45 1.9a2.25 2.25 0 1 0-1.95.218v5.256a2.25 2.25 0 1 0 1.5 0V7.123A5.735 5.735 0 0 0 9.25 9h1.378a2.251 2.251 0 1 0 0-1.5H9.25a4.25 4.25 0 0 1-3.8-2.346zM12.75 9a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5zm-8.5 4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5z' />
                          </svg>
                          <span>
                            Merge <span className='font-mono'>{branch.name}</span> into{' '}
                            <span className='font-mono'>{currentBranchName}</span>
                          </span>
                        </DropdownMenu.Item>
                        <DropdownMenu.Item
                          disabled={branch.isDefault}
                          onSelect={(e) => {
                            e.preventDefault()
                            if (branch.isDefault) return
                            onDelete(branch)
                          }}
                          title={branch.isDefault ? 'Cannot delete the default branch' : undefined}
                          className={cn(
                            'flex select-none items-center gap-2 px-3 py-1.5 text-xs outline-none',
                            branch.isDefault
                              ? 'cursor-not-allowed text-neutral-400 dark:text-neutral-600'
                              : 'cursor-pointer text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40',
                          )}
                        >
                          <svg className='h-3.5 w-3.5' viewBox='0 0 16 16' fill='currentColor'>
                            <path d='M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25ZM4.005 5.073a.75.75 0 0 1 .673.627l.79 5.532a.75.75 0 0 0 .742.643h3.58a.75.75 0 0 0 .742-.643l.79-5.532a.75.75 0 0 1 1.49.214l-.79 5.532A2.25 2.25 0 0 1 9.79 13.5H6.21a2.25 2.25 0 0 1-2.23-1.928l-.79-5.532a.75.75 0 0 1 .626-.867Z' />
                          </svg>
                          Delete
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Root>
                </div>
              </div>
            )
          })}
        </div>

        {/* Create new branch */}
        <div className='px-2 pb-2'>
          <div className='mb-1 h-[1px] w-full bg-neutral-200 dark:!bg-neutral-850' />
          <CreateBranchPopover projectId={projectId} onCloseParent={handleClose} />
        </div>
      </div>
    </div>
  )
}
