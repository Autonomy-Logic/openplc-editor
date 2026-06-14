import * as Popover from '@radix-ui/react-popover'
import { useMemo, useState } from 'react'

import { useVersionControl } from '../../../../../middleware/shared/providers'
import { useOpenPLCStore } from '../../../../store'
import { cn } from '../../../../utils/cn'
import { notifyNoWritePermission } from '../../../../utils/notify-no-write-permission'
import { getBranchNameFeedback } from '../../../../utils/sanitize-branch-name'

type CreateBranchPopoverProps = {
  projectId: string
  onCreated?: (name: string) => void
  onCloseParent?: () => void
}

export function CreateBranchPopover({ projectId, onCreated, onCloseParent }: CreateBranchPopoverProps) {
  const versionControl = useVersionControl()
  const canEdit = useOpenPLCStore((s) => s.workspace.canEdit)
  const [isOpen, setIsOpen] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [isPending, setIsPending] = useState(false)

  const handleCancel = () => {
    setIsOpen(false)
    setName('')
    setError('')
  }

  // Live sanitization preview. The user can type freely; submitting always
  // uses `feedback.sanitized` so the backend never sees forbidden chars.
  const feedback = useMemo(() => getBranchNameFeedback(name), [name])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const finalName = feedback.sanitized

    if (!finalName) {
      setError(feedback.error ?? 'Branch name cannot be empty')
      return
    }
    if (!versionControl) {
      setError('Version control unavailable')
      return
    }

    setError('')
    setIsPending(true)
    try {
      await versionControl.createBranch(projectId, finalName)
      onCreated?.(finalName)
      setIsOpen(false)
      setName('')
      setError('')
      onCloseParent?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create branch')
    } finally {
      setIsPending(false)
    }
  }

  return (
    <Popover.Root
      open={isOpen}
      onOpenChange={(open) => {
        // No write permission ⇒ warn instead of opening a branch form the
        // backend would reject anyway.
        if (open && !canEdit) {
          notifyNoWritePermission('create branches in')
          return
        }
        setIsOpen(open)
        if (!open) {
          setName('')
          setError('')
        }
      }}
    >
      <Popover.Trigger className='group w-full rounded-md focus:bg-neutral-100 dark:focus:bg-neutral-900'>
        <div className='relative flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-[6px] hover:bg-neutral-100 group-aria-[expanded=true]:bg-neutral-100 group-data-[state=open]:bg-neutral-100 dark:hover:bg-neutral-900 dark:group-aria-[expanded=true]:bg-neutral-900 dark:group-data-[state=open]:bg-neutral-900'>
          <svg className='h-3.5 w-3.5 text-neutral-500 dark:text-neutral-400' viewBox='0 0 16 16' fill='currentColor'>
            <path d='M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z' />
          </svg>
          <span className='flex-1 text-start font-caption text-xs font-normal text-neutral-600 dark:text-neutral-400'>
            Create new branch
          </span>
          <svg className='h-3 w-3 text-neutral-400 dark:text-neutral-500' viewBox='0 0 16 16' fill='currentColor'>
            <path d='M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z' />
          </svg>
        </div>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content sideOffset={14} alignOffset={-8} align='end' side='right'>
          <div
            className='box flex h-fit w-[225px] flex-col gap-3 rounded-lg bg-white px-3 pb-3 pt-2 dark:bg-neutral-950'
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className='flex h-8 w-full flex-col items-center justify-between'>
              <div className='flex w-full select-none items-center gap-2'>
                <svg
                  className='h-3.5 w-3.5 text-neutral-500 dark:text-neutral-400'
                  viewBox='0 0 16 16'
                  fill='currentColor'
                >
                  <path d='M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.5 2.5 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z' />
                </svg>
                <p className='my-[2px] flex-1 text-start font-caption text-xs font-normal text-neutral-1000 dark:text-neutral-300'>
                  New Branch
                </p>
              </div>
              <div className='h-[1px] w-full bg-neutral-200 dark:!bg-neutral-850' />
            </div>
            <form onSubmit={handleSubmit} className='flex h-fit w-full select-none flex-col gap-3'>
              <div className='flex w-full flex-col'>
                <label
                  htmlFor='branch-name'
                  className='flex-1 text-start font-caption text-xs font-normal text-neutral-1000 dark:text-neutral-300'
                >
                  Branch name:
                  {error && <span className='text-red-500'>*</span>}
                </label>
                <input
                  id='branch-name'
                  type='text'
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value)
                    setError('')
                  }}
                  placeholder='feature/my-branch'
                  autoFocus
                  disabled={isPending}
                  className='mb-1 mt-[6px] h-[30px] w-full rounded-md border border-neutral-100 bg-white px-2 py-2 text-cp-sm font-medium text-neutral-850 outline-none dark:border-brand-medium-dark dark:bg-neutral-950 dark:text-neutral-300'
                />
                {error ? (
                  <span className='flex-1 text-start font-caption text-cp-xs font-normal text-red-500 opacity-65'>
                    * {error}
                  </span>
                ) : feedback.error ? (
                  <span className='flex-1 text-start font-caption text-cp-xs font-normal text-red-500 opacity-65'>
                    * {feedback.error}
                  </span>
                ) : feedback.changed && feedback.sanitized ? (
                  <div className='flex-1'>
                    <span className='block break-all text-start font-caption text-cp-xs font-normal text-neutral-1000 opacity-80 dark:text-neutral-300'>
                      Will be created as:{' '}
                      <span className='font-mono font-medium text-blue-600 dark:text-blue-400'>
                        {feedback.sanitized}
                      </span>
                    </span>
                    {feedback.notes.map((note) => (
                      <span
                        key={note}
                        className='mt-1 block text-start font-caption text-cp-xs font-normal text-neutral-1000 opacity-60 dark:text-neutral-300'
                      >
                        · {note}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className='flex-1 text-start font-caption text-cp-xs font-normal text-neutral-1000 opacity-65 dark:text-neutral-300'>
                    ** Spaces and special characters are not allowed
                  </span>
                )}
              </div>
              <div className='flex w-full justify-between'>
                <Popover.Close asChild>
                  <button
                    type='button'
                    className='h-7 w-[88px] rounded-md bg-neutral-100 font-caption text-cp-sm font-medium !text-neutral-1000 hover:bg-neutral-200 dark:bg-white dark:hover:bg-neutral-100'
                    onClick={handleCancel}
                    disabled={isPending}
                  >
                    Cancel
                  </button>
                </Popover.Close>
                <button
                  type='submit'
                  disabled={isPending || !feedback.sanitized || !!feedback.error}
                  className={cn(
                    'h-7 w-[88px] rounded-md bg-brand font-caption text-cp-sm font-medium !text-white hover:bg-brand-medium-dark focus:bg-brand-medium disabled:cursor-not-allowed',
                    (isPending || !feedback.sanitized || !!feedback.error) && 'opacity-50',
                  )}
                >
                  {isPending ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
