/**
 * Retrieve Project from PLC.
 *
 * Picks a device off the LAN scan, authenticates if needed, pulls the stored
 * source project down and opens it.
 *
 * The connection handling is the part worth reading. `RuntimeApiClient` is
 * deliberately single-device: one address, one token authority, and `login`
 * replaces the session. That is a good property, so this respects it rather
 * than working around it:
 *
 *   - target is the device already connected -> retrieve straight away, no
 *     prompt and no re-login, because the session in hand is already the right
 *     one;
 *   - connected to a DIFFERENT device -> say plainly that continuing
 *     disconnects, then ask for the target's credentials;
 *   - not connected -> just ask for credentials.
 *
 * Browsing another device must never quietly log someone out of the one they
 * are working on, which is why the middle case is a prompt rather than a
 * silent switch.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import type { DiscoveredRuntimeDevice } from '../../../../middleware/shared/ports'
import { useProject, useRuntime } from '../../../../middleware/shared/providers'
import { nextStepForDevice } from '../../../services/retrieve-project-connection'
import { useOpenPLCStore } from '../../../store'
import { cn } from '../../../utils/cn'
import { toast } from '../../../utils/toast'
import { Modal, ModalContent, ModalTitle } from '../../_molecules/modal'

type Step = 'pick' | 'confirm-disconnect' | 'credentials' | 'working'

const RetrieveProjectModal = () => {
  const {
    modals,
    modalActions,
    deviceActions,
    workspaceActions,
    sharedWorkspaceActions: { closeProject },
  } = useOpenPLCStore()
  const runtime = useRuntime()
  const projectPort = useProject()
  const runtimeIpAddress = useOpenPLCStore(
    (state) => state.deviceDefinitions.configuration.runtimeIpAddress || '',
  )

  const isOpen = modals['retrieve-project']?.open || false

  const [step, setStep] = useState<Step>('pick')
  const [scanning, setScanning] = useState(false)
  const [devices, setDevices] = useState<DiscoveredRuntimeDevice[]>([])
  const [selected, setSelected] = useState<DiscoveredRuntimeDevice | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busyMessage, setBusyMessage] = useState('')
  const scanIdRef = useRef(0)

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

  const runScan = useCallback(async () => {
    if (!runtime.discoverDevices) {
      setError('Device discovery is not available on this platform.')
      return
    }
    setError('')
    setDevices([])
    setSelected(null)
    setScanning(true)

    const scanId = ++scanIdRef.current
    const result = await runtime.discoverDevices({ durationMs: 3000 })
    if (scanId !== scanIdRef.current) return

    if (!result.success) {
      setError(result.error || 'Could not search the network.')
    } else {
      setDevices((previous) => {
        const merged = new Map(previous.map((device) => [device.ipAddress, device]))
        for (const device of result.devices ?? []) merged.set(device.ipAddress, device)
        return Array.from(merged.values())
      })
    }
    setScanning(false)
  }, [runtime])

  useEffect(() => {
    if (!isOpen) return
    if (!runtime.onDeviceDiscovered) {
      void runScan()
      return
    }
    // Subscribe before scanning so the first replies are not dropped.
    const unsubscribe = runtime.onDeviceDiscovered((device) => {
      setDevices((previous) =>
        previous.some((existing) => existing.ipAddress === device.ipAddress)
          ? previous
          : [...previous, device],
      )
    })
    void runScan()
    return unsubscribe
  }, [isOpen, runScan, runtime])

  /** Fetch, unpack and open. Everything before this is about getting a session. */
  const retrieveAndOpen = useCallback(
    async (device: DiscoveredRuntimeDevice) => {
      if (!runtime.retrieveProject) {
        setError('Retrieving a project is not available on this platform.')
        setStep('pick')
        return
      }

      setStep('working')
      setBusyMessage(`Retrieving ${device.projectName ?? 'the project'} from ${device.ipAddress}...`)

      const retrieved = await runtime.retrieveProject(device.ipAddress)
      if (!retrieved.success || !retrieved.projectPath) {
        setError(retrieved.error || 'The device did not return a project.')
        setStep('pick')
        return
      }

      setBusyMessage('Opening the project...')
      // Close the current project first so its unsaved-changes prompt runs
      // before anything is replaced, exactly as File -> Close Project does.
      closeProject()

      const opened = await projectPort.openProjectByPath(retrieved.projectPath)
      if (!opened.success) {
        setError(opened.error?.description || 'The retrieved project could not be opened.')
        setStep('pick')
        return
      }

      // It lives in a scratch directory until the user picks a location, so the
      // user-facing Save is refused and points at Save As. The build's own
      // flush still runs -- the compiler reads source from disk.
      workspaceActions.setIsEphemeralProject(true)

      // Anything this machine cannot supply, or supplies differently. The
      // second case is the one worth separating: a library with the same name
      // but different bytes builds a DIFFERENT program, silently, and reading
      // "already installed" would be actively misleading.
      const libraries = retrieved.libraries ?? []
      const installable = libraries.filter((library) => library.status !== 'installed')

      if (installable.length > 0 && runtime.installRetrievedLibraries) {
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
          retrieved.projectPath,
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
      }

      toast({
        title: `Retrieved "${retrieved.projectName ?? 'project'}"`,
        description: 'This project has no location yet — use Save As to keep it.',
        variant: 'default',
      })
      close()
    },
    [close, closeProject, projectPort, runtime, workspaceActions],
  )

  const handleContinueFromPick = useCallback(() => {
    if (!selected) return
    setError('')

    const next = nextStepForDevice(runtimeIpAddress, selected.ipAddress)
    if (next === 'retrieve') {
      void retrieveAndOpen(selected)
      return
    }
    setStep(next)
  }, [retrieveAndOpen, runtimeIpAddress, selected])

  const handleLogin = useCallback(async () => {
    if (!selected) return
    setError('')
    setStep('working')
    setBusyMessage(`Signing in to ${selected.ipAddress}...`)

    // The address has to move BEFORE the login: the adapter reads it from the
    // store to know which device to authenticate against. The user has already
    // agreed to leave the previous device at this point, so a failed sign-in
    // leaving the address changed is the outcome they asked for, not a
    // surprise.
    deviceActions.setRuntimeIpAddress(selected.ipAddress)

    const result = await runtime.login({ username, password })
    if (!result.success) {
      setError(result.error || 'Could not sign in to that device.')
      setStep('credentials')
      return
    }
    await retrieveAndOpen(selected)
  }, [deviceActions, password, retrieveAndOpen, runtime, selected, username])

  const retrievable = (device: DiscoveredRuntimeDevice) => Boolean(device.projectName)

  return (
    <Modal open={isOpen} onOpenChange={(open) => !open && close()}>
      <ModalContent className='flex h-[520px] w-[520px] select-none flex-col rounded-lg p-6'>
        <ModalTitle className='mb-2 text-xl font-semibold'>Retrieve Project from PLC</ModalTitle>

        {step === 'pick' && (
          <>
            <p className='mb-4 text-sm text-neutral-600 dark:text-neutral-400'>
              Choose a device to retrieve its stored project. Devices that are not storing one cannot be
              selected.
            </p>

            <div className='mb-3 flex items-center justify-between'>
              <span className='text-sm font-medium text-neutral-850 dark:text-neutral-300'>
                {scanning && (
                  <span className='mr-2 inline-block h-3 w-3 animate-pulse rounded-full bg-brand align-middle' />
                )}
                {scanning ? 'Searching devices...' : `Found ${devices.length} device${devices.length === 1 ? '' : 's'}`}
              </span>
              <button
                type='button'
                onClick={() => void runScan()}
                disabled={scanning}
                className='rounded-md bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-1000 hover:bg-neutral-200 disabled:opacity-50 dark:bg-neutral-850 dark:text-neutral-100'
              >
                Rescan
              </button>
            </div>

            <div className='flex-1 overflow-auto rounded-md border border-neutral-200 dark:border-neutral-800'>
              {devices.length === 0 ? (
                <div className='flex h-full items-center justify-center text-sm text-neutral-500 dark:text-neutral-400'>
                  {scanning ? 'Waiting for responses...' : 'No devices replied.'}
                </div>
              ) : (
                <ul className='divide-y divide-neutral-200 dark:divide-neutral-800'>
                  {devices.map((device) => {
                    const isSelected = selected?.ipAddress === device.ipAddress
                    const canRetrieve = retrievable(device)
                    return (
                      <li key={device.ipAddress}>
                        <button
                          type='button'
                          disabled={!canRetrieve}
                          onClick={() => setSelected(device)}
                          aria-selected={isSelected}
                          className={cn(
                            'flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm',
                            !canRetrieve && 'cursor-not-allowed opacity-50',
                            isSelected
                              ? 'bg-brand/20 dark:bg-brand/30 font-bold shadow-[inset_3px_0_0_var(--primary-default)]'
                              : 'text-neutral-850 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-850',
                          )}
                        >
                          <span className='font-medium text-neutral-950 dark:text-white'>
                            {device.projectName ?? 'No project stored'}
                          </span>
                          <span className='text-xs text-neutral-600 dark:text-neutral-400'>
                            {device.hostname || '(unknown host)'} · {device.ipAddress}
                            {device.runtimeVersion ? ` · ${device.runtimeVersion}` : ''}
                            {device.projectTimestamp ? ` · ${formatTimestamp(device.projectTimestamp)}` : ''}
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
          <div className='flex flex-1 flex-col justify-center gap-4 text-sm'>
            <p className='text-neutral-850 dark:text-neutral-300'>
              Retrieving a project from <strong>{selected.hostname || selected.ipAddress}</strong> requires
              disconnecting from <strong>{runtimeIpAddress}</strong>.
            </p>
            <p className='text-neutral-600 dark:text-neutral-400'>
              You will be signed in to the new device instead. Disconnect and continue?
            </p>
          </div>
        )}

        {step === 'credentials' && selected && (
          <div className='flex flex-1 flex-col justify-center gap-3 text-sm'>
            <p className='text-neutral-600 dark:text-neutral-400'>
              Sign in to <strong>{selected.hostname || selected.ipAddress}</strong>. Retrieving a project
              requires an administrator account on that device.
            </p>
            <input
              autoFocus
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder='Username'
              className='rounded-md border border-neutral-200 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900'
            />
            <input
              type='password'
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && void handleLogin()}
              placeholder='Password'
              className='rounded-md border border-neutral-200 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900'
            />
          </div>
        )}

        {step === 'working' && (
          <div className='flex flex-1 items-center justify-center text-sm text-neutral-600 dark:text-neutral-400'>
            {busyMessage}
          </div>
        )}

        {error && <p className='mt-3 text-sm text-red-600 dark:text-red-400'>{error}</p>}

        <div className='mt-4 flex gap-3'>
          {step === 'pick' && (
            <button
              type='button'
              onClick={handleContinueFromPick}
              disabled={!selected}
              className='flex-1 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-medium-dark disabled:opacity-50'
            >
              Retrieve
            </button>
          )}
          {step === 'confirm-disconnect' && (
            <button
              type='button'
              onClick={() => setStep('credentials')}
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

/** A device timestamp, shown as local time. Falls back to the raw string. */
function formatTimestamp(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}

export { RetrieveProjectModal }
