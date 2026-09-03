/**
 * Change the runtime's version (RTOP-283).
 *
 * The device does the work: the bootloader pulls the image, swaps the
 * container and health-gates the result. This screen picks a version, starts
 * it, and then follows along -- which is why it polls rather than awaiting a
 * response. A pull on a slow device runs for many minutes.
 *
 * Upgrade and downgrade are one action. There is no separate direction and no
 * version floor: pairing an older runtime with an older editor is a
 * legitimate thing to want, and the bootloader stays reachable either way.
 */

import { useRuntime } from '@root/middleware/shared/providers/platform-context'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from '../../../../../_molecules/modal'

type UpdateProgress = {
  state: string
  from?: string
  to?: string
  phase?: string
  percent?: number | null
  error?: string
}

type ChangeVersionModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The version running now, so the list can mark it and avoid a pointless swap. */
  currentVersion: string | null
  /** Called once an update finishes, so the caller can refresh its own view. */
  onFinished?: () => void
}

/** How often to ask the device where it has got to. */
const POLL_INTERVAL_MS = 1500

/** States the bootloader reports while work is still in flight. */
const IN_FLIGHT = new Set(['pulling', 'swapping', 'verifying'])

const ChangeVersionModal = ({ open, onOpenChange, currentVersion, onFinished }: ChangeVersionModalProps) => {
  const runtime = useRuntime()

  const [version, setVersion] = useState('')
  const [progress, setProgress] = useState<UpdateProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  // Kept in a ref so the poll loop can stop itself without being re-created
  // on every tick, which would restart the interval each time.
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollingRef.current !== null) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
  }, [])

  const poll = useCallback(async () => {
    const result = await runtime.bootloader.getUpdateProgress()
    if (!result.success) {
      // A poll failing mid-update is expected: the runtime container is being
      // replaced, and on a host-network device that can briefly interrupt
      // everything. Keep polling rather than declaring failure.
      return
    }
    setProgress(result.data)
    if (!IN_FLIGHT.has(result.data.state)) {
      stopPolling()
      if (result.data.state === 'failed') {
        setError(result.data.error ?? 'The update failed.')
      }
      onFinished?.()
    }
  }, [runtime, stopPolling, onFinished])

  const startUpdate = useCallback(async () => {
    const target = version.trim()
    if (!target) {
      setError('Enter the version to install.')
      return
    }

    setStarting(true)
    setError(null)
    setProgress(null)

    const result = await runtime.bootloader.startUpdate(target)
    setStarting(false)

    if (!result.success) {
      // The bootloader's own wording, which already says what to do about a
      // bad tag or an update already running.
      setError(result.error)
      return
    }
    setProgress(result.data)

    stopPolling()
    pollingRef.current = setInterval(() => {
      void poll()
    }, POLL_INTERVAL_MS)
  }, [runtime, version, poll, stopPolling])

  // Adopt an update that is already running.
  //
  // Opening this modal while the device is mid-update -- because another
  // editor started one, or because this one was closed and reopened -- must
  // show that progress rather than an empty form inviting a second attempt
  // the device will refuse.
  useEffect(() => {
    if (!open) {
      stopPolling()
      return
    }
    let cancelled = false
    void (async () => {
      const result = await runtime.bootloader.getUpdateProgress()
      if (cancelled || !result.success) return
      if (IN_FLIGHT.has(result.data.state)) {
        setProgress(result.data)
        pollingRef.current = setInterval(() => {
          void poll()
        }, POLL_INTERVAL_MS)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, runtime, poll, stopPolling])

  useEffect(() => stopPolling, [stopPolling])

  const inFlight = progress !== null && IN_FLIGHT.has(progress.state)
  const succeeded = progress?.state === 'success'
  // Closing mid-update would be misleading: the device carries on regardless,
  // so the button says so rather than pretending to cancel anything.
  const busy = starting || inFlight

  return (
    <Modal open={open} onOpenChange={busy ? () => undefined : onOpenChange}>
      <ModalContent className='h-fit w-[520px]'>
        <ModalHeader>
          <ModalTitle>Change Runtime Version</ModalTitle>
        </ModalHeader>

        <div className='flex flex-col gap-4'>
          <p className='text-sm text-neutral-700 dark:text-neutral-300'>
            The device downloads the version you choose and restarts its runtime. Installing an older version is
            supported.
          </p>

          <label className='flex flex-col gap-1'>
            <span className='text-xs font-medium text-neutral-600 dark:text-neutral-400'>Version</span>
            <input
              aria-label='Runtime version to install'
              className='rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white'
              disabled={busy}
              onChange={(event) => setVersion(event.target.value)}
              placeholder={currentVersion ?? 'v4.2.1'}
              value={version}
            />
            {currentVersion && (
              <span className='text-xs text-neutral-500 dark:text-neutral-400'>
                Currently running {currentVersion}
              </span>
            )}
          </label>

          {progress && (
            <div aria-live='polite' className='flex flex-col gap-2'>
              <div className='flex items-center justify-between text-sm'>
                <span className='text-neutral-700 dark:text-neutral-300'>
                  {describeState(progress)}
                </span>
                {/* No percentage while the daemon has reported no size to work
                    from -- for layers it already holds, and before any size is
                    known. Showing 0% there would read as a stall. */}
                {typeof progress.percent === 'number' && (
                  <span className='tabular-nums text-neutral-500 dark:text-neutral-400'>{progress.percent}%</span>
                )}
              </div>
              <div className='h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800'>
                <div
                  className={`h-full rounded-full transition-all ${
                    progress.state === 'failed' ? 'bg-red-500' : 'bg-brand'
                  } ${typeof progress.percent === 'number' ? '' : 'animate-pulse'}`}
                  style={{ width: typeof progress.percent === 'number' ? `${progress.percent}%` : '100%' }}
                />
              </div>
            </div>
          )}

          {succeeded && (
            <p className='text-sm text-green-700 dark:text-green-400'>
              {progress?.to} is installed and running. Upload your project again so it is rebuilt for this version.
            </p>
          )}

          {error && (
            <p className='text-sm text-red-600 dark:text-red-400' role='alert'>
              {error}
            </p>
          )}

          {inFlight && (
            <p className='text-xs text-neutral-500 dark:text-neutral-400'>
              The device continues on its own if you close the editor. On a slow connection this can take several
              minutes.
            </p>
          )}
        </div>

        <ModalFooter className='flex justify-end gap-2'>
          <button
            className='rounded-md px-3 py-2 text-sm text-neutral-700 disabled:opacity-50 dark:text-neutral-300'
            disabled={busy}
            onClick={() => onOpenChange(false)}
            type='button'
          >
            {succeeded ? 'Close' : 'Cancel'}
          </button>
          {!succeeded && (
            <button
              className='rounded-md bg-brand px-3 py-2 text-sm font-medium text-white disabled:opacity-50'
              disabled={busy || !version.trim()}
              onClick={() => void startUpdate()}
              type='button'
            >
              {busy ? 'Installing…' : 'Install'}
            </button>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

/** Plain wording for a state, so the UI never shows a bare enum. */
const describeState = (progress: UpdateProgress): string => {
  switch (progress.state) {
    case 'pulling':
      // The daemon's own phase ("Downloading", "Extracting") when there is
      // one: it is what every other Docker tool shows, so matching it means
      // the two never disagree.
      return progress.phase ? `Downloading ${progress.to} — ${progress.phase}` : `Downloading ${progress.to}`
    case 'swapping':
      return 'Replacing the runtime'
    case 'verifying':
      return 'Waiting for the new runtime to start'
    case 'success':
      return `Installed ${progress.to}`
    case 'failed':
      return 'The update failed'
    default:
      return progress.state
  }
}

export { ChangeVersionModal }
