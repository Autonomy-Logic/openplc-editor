import { useEffect } from 'react'

export type CarryCheckState = 'loading' | 'available' | 'conflict' | 'error'

type UnsavedChangesWarningModalProps = {
  isOpen: boolean
  targetBranchName: string
  carryCheckState: CarryCheckState
  conflictedFiles: string[]
  onDiscard: () => void
  onCarry: () => void
  onCancel: () => void
}

export function UnsavedChangesWarningModal({
  isOpen,
  targetBranchName,
  carryCheckState,
  conflictedFiles,
  onDiscard,
  onCarry,
  onCancel,
}: UnsavedChangesWarningModalProps) {
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onCancel])

  if (!isOpen) return null

  const carryDisabled = carryCheckState !== 'available'

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center'>
      <div className='absolute inset-0 bg-black/40' onClick={onCancel} />
      <div className='relative w-96 rounded-lg border border-neutral-200 bg-white p-5 shadow-xl dark:border-neutral-700 dark:bg-neutral-900'>
        <h3 className='mb-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100'>Unsaved Changes</h3>
        <p className='mb-3 text-xs text-neutral-600 dark:text-neutral-400'>
          You have uncommitted changes. What would you like to do with them when switching to{' '}
          <strong>{targetBranchName}</strong>?
        </p>

        <div className='mb-4 space-y-2 text-xs'>
          <CarryStatusLine state={carryCheckState} conflictedFiles={conflictedFiles} />
        </div>

        <div className='flex justify-end gap-2'>
          <button
            onClick={onCancel}
            className='cursor-pointer rounded-md bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700'
          >
            Cancel
          </button>
          <button
            onClick={onDiscard}
            className='cursor-pointer rounded-md bg-red-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-600'
          >
            Discard & Switch
          </button>
          <button
            onClick={onCarry}
            disabled={carryDisabled}
            className='cursor-pointer rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-neutral-500 dark:disabled:bg-neutral-700 dark:disabled:text-neutral-500'
          >
            Carry to {targetBranchName}
          </button>
        </div>
      </div>
    </div>
  )
}

function CarryStatusLine({ state, conflictedFiles }: { state: CarryCheckState; conflictedFiles: string[] }) {
  if (state === 'loading') {
    return (
      <p className='flex items-center gap-2 text-neutral-500 dark:text-neutral-400'>
        <span className='inline-block h-3 w-3 animate-spin rounded-full border-2 border-neutral-400 border-t-transparent' />
        Checking if changes can be carried…
      </p>
    )
  }

  if (state === 'available') {
    return (
      <p className='text-emerald-600 dark:text-emerald-400'>
        Carry available — changes will follow you to the new branch.
      </p>
    )
  }

  if (state === 'error') {
    return (
      <p className='text-amber-600 dark:text-amber-400'>
        Could not check for conflicts. You can still discard changes or cancel.
      </p>
    )
  }

  // conflict
  return (
    <div className='text-red-600 dark:text-red-400'>
      <p>Cannot carry — conflicts with {targetCount(conflictedFiles)}:</p>
      <ul className='mt-1 max-h-24 list-disc overflow-y-auto pl-5 font-mono text-[11px]'>
        {conflictedFiles.map((path) => (
          <li key={path}>{path}</li>
        ))}
      </ul>
    </div>
  )
}

function targetCount(files: string[]): string {
  return files.length === 1 ? '1 file' : `${files.length} files`
}
