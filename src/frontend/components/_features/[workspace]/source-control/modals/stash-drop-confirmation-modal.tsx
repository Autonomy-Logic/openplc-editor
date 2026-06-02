import { useEffect } from 'react'

type StashDropConfirmationModalProps = {
  isOpen: boolean
  isLoading: boolean
  stashLabel: string
  onConfirm: () => void
  onCancel: () => void
}

export function StashDropConfirmationModal({
  isOpen,
  isLoading,
  stashLabel,
  onConfirm,
  onCancel,
}: StashDropConfirmationModalProps) {
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) onCancel()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isLoading, onCancel])

  if (!isOpen) return null

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center'>
      <div className='absolute inset-0 bg-black/40' onClick={isLoading ? undefined : onCancel} />
      <div className='relative w-80 rounded-lg border border-neutral-200 bg-white p-5 shadow-xl dark:border-neutral-700 dark:bg-neutral-900'>
        <h3 className='mb-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100'>Drop Stash?</h3>
        <p className='mb-4 text-xs text-neutral-600 dark:text-neutral-400'>
          This permanently removes the stash{stashLabel ? ` “${stashLabel}”` : ''} without applying it. This action
          cannot be undone.
        </p>
        <div className='flex justify-end gap-2'>
          <button
            onClick={onCancel}
            disabled={isLoading}
            className='cursor-pointer rounded-md bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-200 disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700'
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className='cursor-pointer rounded-md bg-red-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-600 disabled:opacity-50'
          >
            {isLoading ? 'Dropping...' : 'Drop Stash'}
          </button>
        </div>
      </div>
    </div>
  )
}
