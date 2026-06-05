import { useEffect, useState } from 'react'

import type { Branch } from '../../../../../middleware/shared/ports/version-control-port'
import { useVersionControl } from '../../../../../middleware/shared/providers'
import { useOpenPLCStore } from '../../../../store'
import { notifyNoWritePermission } from '../../../../utils/notify-no-write-permission'
import { toast } from '../../../../utils/toast'

type DeleteBranchModalProps = {
  isOpen: boolean
  projectId: string
  branch: Branch | null
  onClose: () => void
  onDeleted?: () => void
}

export function DeleteBranchModal({ isOpen, projectId, branch, onClose, onDeleted }: DeleteBranchModalProps) {
  const versionControl = useVersionControl()
  const canEdit = useOpenPLCStore((s) => s.workspace.canEdit)
  const [isPending, setIsPending] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isPending) onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isPending, onClose])

  if (!isOpen || !branch) return null

  const handleDelete = () => {
    if (!versionControl) return
    // No write permission ⇒ skip the doomed backend write and warn.
    if (!canEdit) {
      notifyNoWritePermission('delete branches in')
      return
    }

    setIsPending(true)
    versionControl
      .deleteBranch(projectId, branch.id)
      .then(() => {
        onDeleted?.()
        onClose()
      })
      .catch((err: Error) => {
        toast({ title: 'Failed to delete branch', description: err.message || 'Unknown error', variant: 'fail' })
      })
      .finally(() => setIsPending(false))
  }

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center'>
      <div className='absolute inset-0 bg-black/40' onClick={onClose} />
      <div className='relative w-80 rounded-lg border border-neutral-200 bg-white p-5 shadow-xl dark:border-neutral-700 dark:bg-neutral-900'>
        <h3 className='mb-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100'>Delete Branch</h3>
        <p className='mb-4 text-xs text-neutral-600 dark:text-neutral-400'>
          Are you sure you want to delete{' '}
          <span className='font-mono font-semibold text-neutral-900 dark:text-neutral-100'>{branch.name}</span>? This
          action cannot be undone.
        </p>
        <div className='flex justify-end gap-2'>
          <button
            onClick={onClose}
            disabled={isPending}
            className='rounded-md bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-200 disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700'
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={isPending}
            className='rounded-md bg-red-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-600 disabled:opacity-50'
          >
            {isPending ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}
