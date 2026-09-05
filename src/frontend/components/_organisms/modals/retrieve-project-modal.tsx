/**
 * Retrieve Project from PLC.
 *
 * Pick a device, get a session for it, pull the stored source project down and
 * open it. One component for both platforms: the flow is the same everywhere,
 * and the two things that genuinely differ -- where the devices come from, and
 * what "open" means -- sit behind `RuntimePort` rather than in here. The
 * desktop scans a LAN and unpacks to a scratch directory; web asks each
 * orchestrator and parses into the workspace. Nothing else about retrieving is
 * platform-specific, so nothing else is duplicated.
 *
 * The connection handling is the part worth reading. A client holds a session
 * for one device at a time, and signing in replaces it. That is a good property,
 * so this respects it rather than working around it:
 *
 *   - the target is the device already connected -> retrieve straight away, no
 *     prompt and no re-login, because the session in hand is the right one;
 *   - connected to a DIFFERENT device -> say plainly that continuing
 *     disconnects, then ask for the target's credentials;
 *   - not connected -> just ask for credentials.
 *
 * Browsing another device must never quietly log someone out of the one they
 * are working on, which is why the middle case is a prompt and not a silent
 * switch.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { FetchedProject, RetrievableDevice } from '../../../../middleware/shared/ports'
import { useRuntime } from '../../../../middleware/shared/providers'
import { nextStepForDevice } from '../../../services/retrieve-project-connection'
import { useOpenPLCStore } from '../../../store'
import { cn } from '../../../utils/cn'
import { toast } from '../../../utils/toast'
import { Modal, ModalContent, ModalTitle } from '../../_molecules/modal'

type Step = 'pick' | 'confirm-disconnect' | 'credentials' | 'working'

/** A device timestamp, shown as local time. Falls back to the raw string. */
function formatTimestamp(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}

/**
 * Only a device that answered can be known to store nothing.
 *
 * Silence is not an answer, so a device that did not reply stays selectable and
 * the retrieval itself reports what is actually there. Collapsing the two would
 * make the picker assert "No project stored" about a device that may well have
 * one -- and, because that assertion also disables the row, leave the user no
 * way to find out.
 */
function canRetrieve(device: RetrievableDevice): boolean {
  return Boolean(device.projectName) || !device.answeredScan
}

/** The row's headline: the project it holds, or the best thing we can say instead. */
function rowTitle(device: RetrievableDevice): string {
  if (device.projectName) return device.projectName
  return device.answeredScan ? 'No project stored' : device.name
}

const RetrieveProjectModal = () => {
  const {
    modals,
    modalActions,
    sharedWorkspaceActions: { closeProject, hasUnsavedChanges },
  } = useOpenPLCStore()
  const runtime = useRuntime()

  const isOpen = modals['retrieve-project']?.open || false

  const [step, setStep] = useState<Step>('pick')
  const [scanning, setScanning] = useState(false)
  const [devices, setDevices] = useState<RetrievableDevice[]>([])
  const [selected, setSelected] = useState<RetrievableDevice | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busyMessage, setBusyMessage] = useState('')
  const scanIdRef = useRef(0)
  // A scan already running is joined rather than started again. Two in flight
  // together each send their own discovery probe, and a runtime rate-limits
  // probes from one address: the second goes unanswered, so the scan that
  // finishes last can be the empty one. Mounting effects fire twice in
  // development, which is exactly how that happened.
  const inFlight = useRef<Promise<void> | null>(null)

  const close = useCallback(() => {
    modalActions.onOpenChange('retrieve-project', false)
    setStep('pick')
    setDevices([])
    setSelected(null)
    setUsername('')
    setPassword('')
    setError('')
    setBusyMessage('')
  }, [modalActions])

  /** Merge a row in by key, so a streamed device and a listed one are one row. */
  const mergeDevice = useCallback((device: RetrievableDevice) => {
    setDevices((previous) => {
      const index = previous.findIndex((existing) => existing.key === device.key)
      if (index === -1) return [...previous, device]
      const merged = [...previous]
      merged[index] = device
      return merged
    })
  }, [])

  const runScan = useCallback(async () => {
    if (!runtime.listRetrievableDevices) {
      setError('Retrieving a project is not available on this platform.')
      return
    }
    setError('')
    setDevices([])
    setSelected(null)
    setScanning(true)

    const scanId = ++scanIdRef.current
    const result = await runtime.listRetrievableDevices()
    // A scan the user has already replaced must not write over the newer one.
    if (scanId !== scanIdRef.current) return

    if (!result.success) {
      setError(result.error || 'Could not search for devices.')
    } else {
      for (const device of result.devices) mergeDevice(device)
    }
    setScanning(false)
  }, [mergeDevice, runtime])

  /** One scan at a time; a concurrent caller joins the one already running. */
  const scan = useCallback(() => {
    if (inFlight.current) return inFlight.current
    const running = runScan().finally(() => {
      inFlight.current = null
    })
    inFlight.current = running
    return running
  }, [runScan])

  useEffect(() => {
    if (!isOpen) return
    if (!runtime.onRetrievableDeviceFound) {
      void scan()
      return
    }
    // Subscribe before scanning so the first replies are not dropped.
    const unsubscribe = runtime.onRetrievableDeviceFound(mergeDevice)
    void scan()
    return unsubscribe
  }, [isOpen, mergeDevice, scan, runtime])

  /** Offer what the retrieved project brought, on platforms that can install it. */
  const offerLibraries = useCallback(
    async (project: FetchedProject) => {
      // Anything this machine cannot supply, or supplies differently. The second
      // case is the one worth separating: a library with the same name but
      // different content builds a DIFFERENT program, silently, and reading
      // "already installed" would be actively misleading.
      const libraries = project.libraries ?? []
      const installable = libraries.filter((library) => library.status !== 'installed')
      if (installable.length === 0 || !runtime.installRetrievedLibraries) return

      const differing = installable.filter((library) => library.status === 'differs')
      const missing = installable.filter((library) => library.status === 'missing')
      const lines = [
        missing.length ? `Not installed here: ${missing.map((l) => l.name).join(', ')}.` : '',
        differing.length
          ? `Installed but different from what this project was built with: ${differing
              .map((l) => l.name)
              .join(', ')}. Building without updating them produces a different program.`
          : '',
      ].filter(Boolean)

      const result = await runtime.installRetrievedLibraries(
        project,
        installable.map((library) => library.name),
      )
      toast({
        title: result.success
          ? `Installed ${result.installed.length} librar${result.installed.length === 1 ? 'y' : 'ies'}`
          : 'Some libraries could not be installed',
        description: result.success
          ? lines.join(' ')
          : result.failed.map((failure) => `${failure.name}: ${failure.error}`).join('; '),
        variant: result.success ? 'default' : 'fail',
      })
    },
    [runtime],
  )

  /**
   * Everything after the archive is in hand: open it, mark it, offer its
   * libraries, say so.
   *
   * Deliberately touches no picker state. It runs either directly or as the
   * deferred action of the save-changes dialog, and in the second case this
   * modal has already closed -- so a failure here is reported by a toast, which
   * outlives it, rather than by an error line inside a dialog that is gone.
   */
  const completeRetrieve = useCallback(
    async (project: FetchedProject) => {
      const opened = await runtime.openFetchedProject?.(project)
      if (!opened?.success) {
        toast({
          title: 'The retrieved project could not be opened',
          description: opened?.error || 'The device sent a project this editor could not open.',
          variant: 'fail',
        })
        return
      }

      // Marking it as having no location is `openRetrievedProject`'s job, on
      // the far side of the port: both platforms' adapters end there, so the
      // project arrives already marked. Doing it here as well was the same
      // decision made in two places.
      await offerLibraries(project)

      toast({
        title: `Retrieved "${project.projectName || 'project'}"`,
        description: 'This project has no location yet — use Save As to keep it.',
        variant: 'default',
      })
    },
    [offerLibraries, runtime],
  )

  /** Fetch, then open. Everything before this is about getting a session. */
  const retrieveAndOpen = useCallback(
    async (device: RetrievableDevice) => {
      if (!runtime.fetchRetrievableProject || !runtime.openFetchedProject) {
        setError('Retrieving a project is not available on this platform.')
        setStep('pick')
        return
      }

      setStep('working')
      setBusyMessage(`Retrieving ${device.projectName ?? 'the project'} from ${device.name}...`)

      const fetched = await runtime.fetchRetrievableProject(device)
      if (!fetched.success) {
        setError(fetched.error || 'The device did not return a project.')
        setStep('pick')
        setBusyMessage('')
        return
      }

      setBusyMessage('Opening the project...')

      // The open project is replaced, so unsaved work gets its dialog first --
      // after the fetch, never before, so a device that turns out to have
      // nothing does not cost anyone their project.
      //
      // Its own context, not `closeProject()`'s. That one answers with
      // 'close-project', whose branch clears the workspace and goes back to the
      // start screen; both of its buttons therefore ended the retrieve there,
      // with the archive already fetched and then abandoned. 'retrieve-project'
      // carries the rest of this flow as the dialog's deferred action, so
      // saving and discarding both arrive at the retrieved project.
      if (hasUnsavedChanges()) {
        modalActions.openModal('save-changes-project', {
          validationContext: 'retrieve-project',
          onAfterAction: () => {
            void completeRetrieve(fetched.project)
          },
        })
        // Out of the way of the dialog it just opened; `completeRetrieve` holds
        // everything still to do.
        close()
        return
      }

      closeProject()
      await completeRetrieve(fetched.project)
      close()
    },
    [close, closeProject, completeRetrieve, hasUnsavedChanges, modalActions, runtime],
  )

  const connectedKey = runtime.connectedRetrievableDeviceKey?.() ?? ''

  const handleContinueFromPick = useCallback(() => {
    if (!selected) return
    setError('')

    // All three answers are handled. Collapsing 'confirm-disconnect' into
    // 'credentials' would take the session away from the device the user is
    // working on as a side effect of browsing to another one, which is the
    // exact thing `nextStepForDevice` exists to prevent.
    const next = nextStepForDevice(connectedKey, selected.key)
    if (next === 'confirm-disconnect') {
      // Before selecting: the platform must not be pointed at the new device
      // until the user has agreed to give up the session they hold.
      setStep('confirm-disconnect')
      return
    }

    runtime.selectRetrievableDevice?.(selected)
    if (next === 'retrieve') {
      void retrieveAndOpen(selected)
      return
    }
    setStep('credentials')
  }, [connectedKey, retrieveAndOpen, runtime, selected])

  /** The user accepted losing the session they hold for another device. */
  const confirmDisconnect = useCallback(() => {
    if (!selected) return
    runtime.selectRetrievableDevice?.(selected)
    setStep('credentials')
  }, [runtime, selected])

  const handleLogin = useCallback(async () => {
    if (!selected) return
    setError('')
    setStep('working')
    setBusyMessage(`Signing in to ${selected.name}...`)

    // The platform was pointed at this device before we got here: its adapter
    // reads the target to know what to authenticate against, so the target has
    // to move before the login rather than with it. The user has already agreed
    // to leave the previous device, so a failed sign-in leaving the target
    // changed is the outcome they asked for, not a surprise.
    const result = await runtime.login({ username, password })
    if (!result.success) {
      setError(result.error || 'Could not sign in to that device.')
      setStep('credentials')
      setBusyMessage('')
      return
    }
    await retrieveAndOpen(selected)
  }, [password, retrieveAndOpen, runtime, selected, username])

  /** What the user is currently signed in to, named as well as we can name it. */
  const connectedDeviceLabel = useMemo(() => {
    if (!connectedKey) return ''
    const row = devices.find((device) => device.key === connectedKey)
    return row ? row.name : connectedKey
  }, [connectedKey, devices])

  return (
    <Modal open={isOpen} onOpenChange={(open) => !open && close()}>
      <ModalContent className='flex h-[520px] w-[520px] select-none flex-col rounded-lg p-6'>
        <ModalTitle className='mb-2 text-xl font-semibold'>Retrieve Project from PLC</ModalTitle>

        {step === 'pick' && (
          <>
            <p className='mb-4 text-sm text-neutral-600 dark:text-neutral-400'>
              Choose a device to retrieve its stored project. Retrieving requires an administrator account on that
              device.
            </p>

            <div className='mb-3 flex items-center justify-between'>
              <span className='text-sm font-medium text-neutral-850 dark:text-neutral-300'>
                {scanning ? 'Searching for devices...' : `${devices.length} device${devices.length === 1 ? '' : 's'}`}
              </span>
              <button
                type='button'
                data-testid='retrieve-refresh'
                onClick={() => void scan()}
                disabled={scanning}
                className='rounded-md bg-neutral-100 px-3 py-1 text-sm font-medium text-neutral-1000 hover:bg-neutral-200 disabled:opacity-50 dark:bg-neutral-850 dark:text-neutral-100'
              >
                Refresh
              </button>
            </div>

            <div className='min-h-0 flex-1 overflow-auto rounded-md border border-neutral-200 dark:border-neutral-800'>
              {devices.length === 0 ? (
                <p className='p-4 text-sm text-neutral-500'>
                  {scanning ? 'Looking...' : 'No devices found. Check the network and try Refresh.'}
                </p>
              ) : (
                <ul className='divide-y divide-neutral-200 dark:divide-neutral-800'>
                  {devices.map((device) => {
                    const isSelected = selected?.key === device.key
                    const selectable = canRetrieve(device)
                    return (
                      <li key={device.key}>
                        <button
                          type='button'
                          disabled={!selectable}
                          onClick={() => setSelected(device)}
                          aria-selected={isSelected}
                          className={cn(
                            'flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm',
                            !selectable && 'cursor-not-allowed opacity-50',
                            isSelected
                              ? 'bg-brand/20 dark:bg-brand/30 font-bold shadow-[inset_3px_0_0_var(--primary-default)]'
                              : 'text-neutral-850 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-850',
                          )}
                        >
                          <span className='font-medium text-neutral-950 dark:text-white'>{rowTitle(device)}</span>
                          <span className='text-xs text-neutral-600 dark:text-neutral-400'>
                            {device.name}
                            {device.location ? ` · ${device.location}` : ''}
                            {device.projectTimestamp ? ` · ${formatTimestamp(device.projectTimestamp)}` : ''}
                            {!device.answeredScan ? ' · project unknown' : ''}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </>
        )}

        {step === 'confirm-disconnect' && selected && (
          <div data-testid='retrieve-confirm-disconnect' className='text-sm text-neutral-850 dark:text-neutral-300'>
            <p>
              You are signed in to <strong>{connectedDeviceLabel}</strong>. Retrieving from{' '}
              <strong>{selected.name}</strong> signs you out of it.
            </p>
            <p className='mt-2 text-neutral-600 dark:text-neutral-400'>
              One device is connected at a time, so continuing ends the session you are using.
            </p>
          </div>
        )}

        {step === 'credentials' && selected && (
          <div className='flex flex-col gap-3'>
            <p className='text-sm text-neutral-850 dark:text-neutral-300'>
              Sign in to <strong>{selected.name}</strong>. Retrieving a project requires an administrator account on
              that device.
            </p>
            <input
              autoFocus
              type='text'
              placeholder='Username'
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className='rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100'
            />
            <input
              type='password'
              placeholder='Password'
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className='rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100'
            />
          </div>
        )}

        {step === 'working' && (
          <div className='flex flex-1 items-center justify-center text-sm text-neutral-600 dark:text-neutral-400'>
            {busyMessage}
          </div>
        )}

        {step !== 'working' && busyMessage && (
          <p className='mt-3 text-sm text-neutral-600 dark:text-neutral-400'>{busyMessage}</p>
        )}
        {error && (
          <p data-testid='retrieve-error' className='mt-3 text-sm text-red-600 dark:text-red-400'>
            {error}
          </p>
        )}

        <div className='mt-4 flex gap-3'>
          {step === 'pick' && (
            <button
              type='button'
              onClick={handleContinueFromPick}
              disabled={!selected}
              className='flex-1 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-medium-dark disabled:opacity-50'
            >
              Continue
            </button>
          )}
          {step === 'confirm-disconnect' && (
            <button
              type='button'
              onClick={confirmDisconnect}
              className='flex-1 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-medium-dark'
            >
              Disconnect and continue
            </button>
          )}
          {step === 'credentials' && (
            <button
              type='button'
              onClick={() => void handleLogin()}
              disabled={!username || !password}
              className='flex-1 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-medium-dark disabled:opacity-50'
            >
              Sign in and retrieve
            </button>
          )}
          <button
            type='button'
            onClick={close}
            disabled={step === 'working'}
            className='flex-1 rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-1000 hover:bg-neutral-200 disabled:opacity-50 dark:bg-neutral-850 dark:text-neutral-100'
          >
            Cancel
          </button>
        </div>
      </ModalContent>
    </Modal>
  )
}

export { RetrieveProjectModal }
