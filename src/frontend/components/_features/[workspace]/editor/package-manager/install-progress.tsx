/**
 * Progress of a board package's dependency installation: a hook that tracks the
 * running install, update or Reinstall, and the blocking modal that shows it.
 */

import type { PackageInstallProgress } from '@root/middleware/shared/ports/types'
import { usePackages } from '@root/middleware/shared/providers/platform-context'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Modal, ModalContent } from '../../../../_molecules/modal'

export interface PackageInstallTracker {
  /** The latest progress of the running operation, or null when none reported yet. */
  progress: PackageInstallProgress | null
  /** Runs @p operation, showing its dependency progress until it settles. */
  track: <T>(operation: () => Promise<T>) => Promise<T>
}

export function usePackageInstallTracker(): PackageInstallTracker {
  const packages = usePackages()
  const [progress, setProgress] = useState<PackageInstallProgress | null>(null)
  const running = useRef(0)

  useEffect(() => {
    if (!packages) return
    return packages.onInstallProgress((update) => {
      if (running.current > 0) setProgress(update)
    })
  }, [packages])

  const track = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    running.current += 1
    try {
      return await operation()
    } finally {
      running.current -= 1
      if (running.current === 0) setProgress(null)
    }
  }, [])

  return { progress, track }
}

export function PackageInstallProgressModal({ progress }: { progress: PackageInstallProgress | null }) {
  const packages = usePackages()
  const [cancelling, setCancelling] = useState(false)

  useEffect(() => {
    if (progress === null) setCancelling(false)
  }, [progress])

  const cancel = () => {
    setCancelling(true)
    packages?.cancelInstall()
  }

  const percent = progress?.download?.percent
  return (
    <Modal open={progress !== null}>
      <ModalContent
        className='flex h-fit w-[460px] select-none flex-col gap-4 rounded-lg p-6'
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        aria-label='Installing board package dependencies'
      >
        <h2 className='text-lg font-medium text-neutral-950 dark:text-white'>Installing board package</h2>
        <p
          className='font-caption text-cp-sm text-neutral-850 dark:text-neutral-300'
          data-testid='package-install-step'
        >
          {progress && progress.total > 0
            ? `${progress.label} (${progress.step} of ${progress.total})`
            : progress?.label}
        </p>
        {progress?.download && (
          <div className='flex flex-col gap-1'>
            <div className='h-2 w-full overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800'>
              <div className='h-full bg-brand' style={{ width: `${Math.min(100, Math.max(0, percent ?? 0))}%` }} />
            </div>
            <span className='text-[11px] text-neutral-500 dark:text-neutral-400' data-testid='package-install-download'>
              {progress.download.item}: {progress.download.done} / {progress.download.total}
            </span>
          </div>
        )}
        <div className='flex justify-end'>
          <button
            type='button'
            onClick={cancel}
            disabled={cancelling}
            className='rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium disabled:opacity-50 dark:bg-neutral-850 dark:text-neutral-100'
          >
            {cancelling ? 'Cancelling…' : 'Cancel'}
          </button>
        </div>
      </ModalContent>
    </Modal>
  )
}
