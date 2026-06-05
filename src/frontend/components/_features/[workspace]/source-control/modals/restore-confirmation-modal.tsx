import { useEffect } from 'react'

type RestoreConfirmationModalProps = {
  isOpen: boolean
  isLoading: boolean
  commitHash: string
  commitMessage: string
  onConfirm: () => void
  onCancel: () => void
}

export function RestoreConfirmationModal({
  isOpen,
  isLoading,
  commitHash,
  commitMessage,
  onConfirm,
  onCancel,
}: RestoreConfirmationModalProps) {
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
      <div className='absolute inset-0 bg-black/40' onClick={onCancel} />
      <div className='relative w-80 rounded-lg border border-neutral-200 bg-white p-5 shadow-xl dark:border-neutral-700 dark:bg-neutral-900'>
        <h3 className='mb-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100'>Restore to This Version?</h3>
        <p className='mb-1 text-xs text-neutral-600 dark:text-neutral-400'>
          This will restore all project files to commit{' '}
          <span className='font-mono text-blue-500'>{commitHash.slice(0, 7)}</span>:
        </p>
        <p className='mb-3 truncate text-xs italic text-neutral-700 dark:text-neutral-300'>
          &ldquo;{commitMessage}&rdquo;
        </p>
        <p className='mb-4 text-xs text-yellow-600 dark:text-yellow-400'>
          Current unsaved changes will be overwritten. This action cannot be undone.
        </p>
        <div className='flex justify-end gap-2'>
          <button
            onClick={onCancel}
            disabled={isLoading}
            className='rounded-md bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-200 disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700'
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className='rounded-md bg-blue-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-50'
          >
            {isLoading ? 'Restoring...' : 'Restore'}
          </button>
        </div>
      </div>
    </div>
  )
}
