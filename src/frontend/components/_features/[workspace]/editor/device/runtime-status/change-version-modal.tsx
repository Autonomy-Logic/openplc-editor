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

import * as Select from '@radix-ui/react-select'
import { ArrowIcon } from '@root/frontend/assets/icons/interface/Arrow'
import { useOpenPLCStore } from '@root/frontend/store'
import { useRuntime } from '@root/middleware/shared/providers/platform-context'
import {
  clearRuntimeVersionsCache,
  listRuntimeVersions,
  type RuntimeVersion,
} from '@root/middleware/shared/utils/runtime-versions'
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
  // Tells the status poller to stand down: the runtime is about to be stopped
  // and replaced, and that silence must not be read as a lost connection.
  const setRuntimeUpdateInProgress = useOpenPLCStore((state) => state.deviceActions.setRuntimeUpdateInProgress)

  const [version, setVersion] = useState('')
  const [progress, setProgress] = useState<UpdateProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  // The installable versions, and whether they could be read at all. A device
  // on a workbench with no internet still needs to be able to install a
  // version it already holds, so a failed listing falls back to typing rather
  // than blocking the action.
  const [versions, setVersions] = useState<RuntimeVersion[] | null>(null)
  const [versionsError, setVersionsError] = useState<string | null>(null)
  const [loadingVersions, setLoadingVersions] = useState(false)

  // Kept in a ref so the poll loop can stop itself without being re-created
  // on every tick, which would restart the interval each time.
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // onFinished is a prop, and callers pass an inline arrow -- a new function
  // every render. Depending on it directly made `poll` unstable, which made
  // the effect below unstable, which leaked a timer per render while an
  // update was running. Each leaked timer re-rendered the parent, which
  // leaked another: the count compounded until the app was firing hundreds of
  // requests a second and everything downstream fell over. Holding it in a ref
  // keeps the callback current without putting its identity in a dep array.
  const onFinishedRef = useRef(onFinished)
  useEffect(() => {
    onFinishedRef.current = onFinished
  }, [onFinished])

  const stopPolling = useCallback(() => {
    if (pollingRef.current !== null) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
    setRuntimeUpdateInProgress(false)
  }, [setRuntimeUpdateInProgress])

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
      onFinishedRef.current?.()
    }
  }, [runtime, stopPolling])

  /**
   * Begin following an update, replacing any loop already running.
   *
   * Every start goes through here. Assigning `pollingRef.current` at a call
   * site is what allowed a second timer to exist while the first kept
   * ticking, unreferenced and unstoppable.
   */
  const startPolling = useCallback(() => {
    stopPolling()
    setRuntimeUpdateInProgress(true)
    pollingRef.current = setInterval(() => {
      void poll()
    }, POLL_INTERVAL_MS)
  }, [poll, stopPolling, setRuntimeUpdateInProgress])

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
    startPolling()
  }, [runtime, version, startPolling])

  const loadVersions = useCallback(async (signal?: AbortSignal) => {
    setLoadingVersions(true)
    const result = await listRuntimeVersions(signal)
    if (signal?.aborted) return
    setLoadingVersions(false)
    if (result.ok) {
      setVersions(result.versions)
      setVersionsError(null)
      return
    }
    if (result.error === 'cancelled') return
    setVersions(null)
    setVersionsError(result.error)
  }, [])

  // Fetched when the dialog opens rather than on mount: the list is only
  // needed here, and a screen that merely displays runtime status should not
  // reach out to the network on its own.
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    void loadVersions(controller.signal)
    return () => controller.abort()
  }, [open, loadVersions])

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
        startPolling()
      }
    })()
    // Stopping the timer here is not optional: without it a re-run of this
    // effect abandons the previous one still ticking.
    return () => {
      cancelled = true
      stopPolling()
    }
  }, [open, runtime, startPolling, stopPolling])

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

          <div className='flex flex-col gap-1'>
            <span className='text-xs font-medium text-neutral-600 dark:text-neutral-400'>Version</span>

            {versions !== null ? (
              <Select.Root disabled={busy} onValueChange={setVersion} value={version}>
                <Select.Trigger
                  aria-label='Runtime version to install'
                  className='flex h-9 w-full items-center justify-between rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-900 outline-none disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white'
                >
                  <span>{version === '' ? 'Select a version' : describeChoice(version, currentVersion)}</span>
                  <ArrowIcon direction='down' className='stroke-brand' />
                </Select.Trigger>

                <Select.Content
                  align='center'
                  className='z-[999999] max-h-64 w-[--radix-select-trigger-width] overflow-y-auto rounded-md border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900'
                  position='popper'
                  side='bottom'
                  sideOffset={1}
                >
                  <Select.Viewport>
                    {versions.map((entry) => (
                      <Select.Item
                        className='w-full cursor-pointer rounded-sm px-3 py-1.5 text-sm text-neutral-900 outline-none hover:bg-neutral-100 dark:text-white dark:hover:bg-neutral-850'
                        key={entry.tag}
                        value={entry.tag}
                      >
                        <Select.ItemText>{describeChoice(entry.tag, currentVersion)}</Select.ItemText>
                      </Select.Item>
                    ))}
                  </Select.Viewport>
                </Select.Content>
              </Select.Root>
            ) : (
              // No list. Typing is the only way left to reach a version, and
              // it is a real one on an offline device holding a side-loaded
              // image -- so the field stays usable and says why it is here.
              <input
                aria-label='Runtime version to install'
                className='h-9 rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-900 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white'
                disabled={busy || loadingVersions}
                onChange={(event) => setVersion(event.target.value)}
                placeholder={loadingVersions ? 'Loading versions…' : (currentVersion ?? 'v4.2.1')}
                value={version}
              />
            )}

            {versionsError !== null && (
              <span className='flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400'>
                {versionsError} Type a version instead.
                <button
                  className='underline disabled:opacity-50'
                  disabled={loadingVersions}
                  onClick={() => {
                    clearRuntimeVersionsCache()
                    void loadVersions()
                  }}
                  type='button'
                >
                  Retry
                </button>
              </span>
            )}

            {currentVersion && (
              <span className='text-xs text-neutral-500 dark:text-neutral-400'>
                Currently running {currentVersion}
              </span>
            )}
          </div>

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
              disabled={busy || !version.trim() || version === currentVersion}
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

/**
 * How one version reads in the list.
 *
 * The running version is marked rather than hidden: seeing it in place is what
 * tells someone the list is the right list, and a gap where they expected it
 * would read as a missing release.
 */
const describeChoice = (tag: string, currentVersion: string | null): string =>
  tag === currentVersion ? `${tag} (installed)` : tag

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
