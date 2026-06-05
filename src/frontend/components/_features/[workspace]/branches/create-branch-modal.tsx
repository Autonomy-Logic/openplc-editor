import { useEffect, useState } from 'react'

import { useVersionControl } from '../../../../../middleware/shared/providers'
import { useOpenPLCStore } from '../../../../store'
import { notifyNoWritePermission } from '../../../../utils/notify-no-write-permission'

type CreateBranchModalProps = {
  isOpen: boolean
  projectId: string
  onClose: () => void
  onCreated?: (name: string) => void
}

export function CreateBranchModal({ isOpen, projectId, onClose, onCreated }: CreateBranchModalProps) {
  const versionControl = useVersionControl()
  const canEdit = useOpenPLCStore((s) => s.workspace.canEdit)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [isPending, setIsPending] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isPending) onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isPending, onClose])

  useEffect(() => {
    if (isOpen) {
      setName('')
      setError('')
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    // No write permission ⇒ skip the doomed backend write and warn.
    if (!canEdit) {
      notifyNoWritePermission('create branches in')
      return
    }

    const trimmed = name.trim()

    if (!trimmed) {
      setError('Branch name cannot be empty')
      return
    }

    if (/\s/.test(trimmed)) {
      setError('Branch name cannot contain spaces')
      return
    }

    if (/[~^:?*[\]\\]/.test(trimmed)) {
      setError('Branch name contains invalid characters')
      return
    }

    if (/(\.\.|\/\/|@\{|\.lock$|^\.|^\/|\/$)/.test(trimmed)) {
      setError('Branch name has an invalid format')
      return
    }

    if (!versionControl) return

    setError('')
    setIsPending(true)
    versionControl
      .createBranch(projectId, trimmed)
      .then(() => {
        onCreated?.(trimmed)
        onClose()
      })
      .catch((err: Error) => {
        setError(err.message || 'Failed to create branch')
      })
      .finally(() => setIsPending(false))
  }

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center'>
      <div className='absolute inset-0 bg-black/40' onClick={onClose} />
      <div className='relative w-80 rounded-lg border border-neutral-200 bg-white p-5 shadow-xl dark:border-neutral-700 dark:bg-neutral-900'>
        <h3 className='mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100'>Create Branch</h3>
        <form onSubmit={handleSubmit}>
          <input
            type='text'
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder='feature/my-new-branch'
            autoFocus
            disabled={isPending}
            className='w-full rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-900 placeholder-neutral-400 outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder-neutral-500'
          />
          {error ? (
            <p className='mt-1 text-xs text-red-500'>{error}</p>
          ) : (
            <p className='mt-1 text-xs text-neutral-400 dark:text-neutral-500'>No spaces allowed</p>
          )}
          <div className='mt-4 flex justify-end gap-2'>
            <button
              type='button'
              onClick={onClose}
              disabled={isPending}
              className='rounded-md bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-200 disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700'
            >
              Cancel
            </button>
            <button
              type='submit'
              disabled={isPending}
              className='rounded-md bg-blue-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-50'
            >
              {isPending ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
