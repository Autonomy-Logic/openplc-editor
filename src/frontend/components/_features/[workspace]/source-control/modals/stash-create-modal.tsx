import { useEffect, useState } from 'react'

type StashCreateModalProps = {
  isOpen: boolean
  isLoading: boolean
  fileCount: number
  totalCount: number
  onConfirm: (message: string) => void
  onCancel: () => void
}

export function StashCreateModal({
  isOpen,
  isLoading,
  fileCount,
  totalCount,
  onConfirm,
  onCancel,
}: StashCreateModalProps) {
  const [message, setMessage] = useState('')

  // Reset the field whenever the modal is (re)opened so a previous draft
  // doesn't leak into the next stash.
  useEffect(() => {
    if (isOpen) setMessage('')
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) onCancel()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isLoading, onCancel])

  if (!isOpen) return null

  const isAll = fileCount === totalCount
  const description = isAll
    ? 'Saves all pending changes to a stash and reverts the working tree to the last commit. You can re-apply the stash later.'
    : `Saves the selected ${fileCount} file${fileCount > 1 ? 's' : ''} to a stash and reverts ${
        fileCount > 1 ? 'them' : 'it'
      } to the last committed state. You can re-apply the stash later.`

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center'>
      <div className='absolute inset-0 bg-black/40' onClick={isLoading ? undefined : onCancel} />
      <div className='relative w-80 rounded-lg border border-neutral-200 bg-white p-5 shadow-xl dark:border-neutral-700 dark:bg-neutral-900'>
        <h3 className='mb-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100'>Stash Changes</h3>
        <p className='mb-3 text-xs text-neutral-600 dark:text-neutral-400'>{description}</p>
        <input
          type='text'
          value={message}
          autoFocus
          onChange={(e) => setMessage(e.target.value.slice(0, 200))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !isLoading) onConfirm(message.trim())
          }}
          placeholder='Stash message (optional)'
          className='mb-4 w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs text-neutral-800 placeholder-neutral-400 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:placeholder-neutral-500'
        />
        <div className='flex justify-end gap-2'>
          <button
            onClick={onCancel}
            disabled={isLoading}
            className='cursor-pointer rounded-md bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-200 disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700'
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(message.trim())}
            disabled={isLoading}
            className='cursor-pointer rounded-md bg-blue-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-50'
          >
            {isLoading ? 'Stashing...' : 'Stash Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
